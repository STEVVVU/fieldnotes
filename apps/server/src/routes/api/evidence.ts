import { escapeHtml } from "@triliumnext/commons";
import type {
    EvidenceCapture,
    EvidenceManifest,
    EvidenceReceipt
} from "@triliumnext/commons/src/lib/evidence_capture.js";
import { becca, type BNote, note_service as notes, ValidationError } from "@triliumnext/core";
import type { Request } from "express";
import { createHash } from "node:crypto";
import { parse } from "node-html-parser";

const SNAPSHOT = "snapshot.html.txt";
const MANIFEST = "evidence-manifest.json";
const MAX_CONTENT_BYTES = 1024 * 1024;
const CAPTURE_KEYS = [
    "schemaVersion",
    "captureId",
    "mode",
    "sourceUrl",
    "title",
    "capturedAt",
    "extractor",
    "content",
    "contentSha256"
];

export function saveEvidence(req: Request) {
    const capture = parseCapture(req.body);
    const payloadSha256 = sha256(JSON.stringify(capture));
    const noteId = `evidence_${capture.captureId}`;
    const existing = becca.getNote(noteId);
    if (existing) {
        const record = readRecord(existing);
        if (
            !existing.isDeleted &&
            record?.integrity === "verified" &&
            record.receipt.payloadSha256 === payloadSha256
        ) {
            return { ...record.receipt, replayed: true };
        }
        return [409, { error: "Capture ID already exists with different or changed evidence." }];
    }

    const dom = parse(capture.content);
    const urls = new Set<string>();
    for (const image of dom.querySelectorAll("img")) {
        const source = image.getAttribute("src");
        if (source) {
            try {
                urls.add(new URL(source, capture.sourceUrl).href);
            } catch {
                urls.add(source.slice(0, 4096));
            }
        }
    }
    if (urls.size > 200) throw new ValidationError("A capture can reference at most 200 images.");
    const { content, ...metadata } = capture;
    const manifest: EvidenceManifest = {
        schemaVersion: 1,
        capture: metadata,
        receivedAt: new Date().toISOString(),
        payloadSha256,
        snapshot: {
            sha256: capture.contentSha256,
            bytes: Buffer.byteLength(content),
            encoding: "utf-8",
            mime: "text/html"
        },
        assets: Array.from(urls, (url) => ({ url, status: "not-captured" })),
        transformations: ["html-to-inert-text"]
    };
    for (const node of dom.querySelectorAll("script,style,iframe,object,embed,template"))
        node.remove();
    const note = notes.createNewNote({
        noteId,
        parentNoteId: "root",
        title: `Evidence: ${capture.title}`,
        type: "text",
        content:
            `<p>Captured ${escapeHtml(capture.capturedAt)} from <a href="${escapeHtml(capture.sourceUrl)}">${escapeHtml(capture.sourceUrl)}</a>.</p>` +
            `<p>Snapshot and manifest are in this note's attachments. External images are not downloaded. This reading is an inert text conversion.</p><pre>${escapeHtml(dom.structuredText)}</pre>`
    }).note;
    const snapshot = note.saveAttachment({
        role: "file",
        title: SNAPSHOT,
        mime: "text/plain; charset=utf-8",
        content,
        position: 0
    });
    const manifestContent = JSON.stringify(manifest, null, 2);
    const attachment = note.saveAttachment({
        role: "file",
        title: MANIFEST,
        mime: "application/json",
        content: manifestContent,
        position: 1
    });
    note.setLabel("fieldnotesEvidence", "1");
    note.setLabel("evidencePayloadSha256", payloadSha256);
    note.setLabel("evidenceManifestSha256", sha256(manifestContent));
    if (!snapshot.attachmentId || !attachment.attachmentId)
        throw new Error("Evidence attachment IDs are missing.");
    return {
        captureId: capture.captureId,
        noteId,
        payloadSha256,
        snapshotAttachmentId: snapshot.attachmentId,
        manifestAttachmentId: attachment.attachmentId,
        replayed: false
    } satisfies EvidenceReceipt;
}

export function getEvidence(req: Request<{ captureId: string }>) {
    if (!/^[a-f0-9]{32}$/.test(req.params.captureId))
        throw new ValidationError("Invalid capture ID.");
    const note = becca.getNote(`evidence_${req.params.captureId}`);
    if (!note || note.isDeleted || note.getOwnedLabelValue("fieldnotesEvidence") !== "1")
        return [404, { error: "Capture not found." }];
    return (
        readRecord(note) ?? {
            integrity: "changed",
            error: "Evidence attachments are missing or malformed."
        }
    );
}

function parseCapture(value: unknown): EvidenceCapture {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new ValidationError("Expected a capture object.");
    const fields = value as Record<string, unknown>;
    if (
        Object.keys(fields).length !== CAPTURE_KEYS.length ||
        Object.keys(fields).some((key) => !CAPTURE_KEYS.includes(key))
    ) {
        throw new ValidationError("Unexpected capture fields.");
    }
    if (fields.schemaVersion !== 1 || (fields.mode !== "article" && fields.mode !== "selection"))
        throw new ValidationError("Unsupported capture version or mode.");
    const captureId = boundedString(fields.captureId, 32, "captureId");
    if (!/^[a-f0-9]{32}$/.test(captureId)) throw new ValidationError("Invalid capture ID.");
    const sourceUrl = boundedString(fields.sourceUrl, 4096, "sourceUrl");
    let source: URL;
    try {
        source = new URL(sourceUrl);
    } catch {
        throw new ValidationError("Invalid source URL.");
    }
    if (!["https:", "http:"].includes(source.protocol) || source.username || source.password)
        throw new ValidationError("Source URL must be HTTP or HTTPS without credentials.");
    const title = boundedString(fields.title, 500, "title");
    const capturedAt = boundedString(fields.capturedAt, 24, "capturedAt");
    if (
        !Number.isFinite(Date.parse(capturedAt)) ||
        new Date(capturedAt).toISOString() !== capturedAt
    )
        throw new ValidationError("Invalid capture timestamp.");
    const extractor = boundedString(fields.extractor, 80, "extractor");
    if (extractor !== (fields.mode === "article" ? "defuddle/0.19.5" : "dom-selection/1"))
        throw new ValidationError("Unsupported extractor.");
    const content = boundedString(fields.content, MAX_CONTENT_BYTES, "content");
    if (
        Buffer.byteLength(content) > MAX_CONTENT_BYTES ||
        Buffer.from(content, "utf8").toString("utf8") !== content
    )
        throw new ValidationError(
            "Capture exceeds the UTF-8 content limit or contains invalid Unicode."
        );
    const contentSha256 = boundedString(fields.contentSha256, 64, "contentSha256");
    if (!/^[a-f0-9]{64}$/.test(contentSha256) || sha256(content) !== contentSha256)
        throw new ValidationError("Snapshot digest does not match its content.");
    return {
        schemaVersion: 1,
        captureId,
        mode: fields.mode,
        sourceUrl,
        title,
        capturedAt,
        extractor,
        content,
        contentSha256
    };
}

function boundedString(value: unknown, maxLength: number, field: string) {
    if (typeof value !== "string" || !value.trim() || value.length > maxLength)
        throw new ValidationError(`Invalid ${field}.`);
    return value;
}

function readRecord(note: BNote) {
    const snapshot = note.getAttachmentByTitle(SNAPSHOT);
    const attachment = note.getAttachmentByTitle(MANIFEST);
    if (
        !snapshot?.attachmentId ||
        !attachment?.attachmentId ||
        note.getOwnedLabelValue("fieldnotesEvidence") !== "1"
    )
        return undefined;
    const manifestContent = attachment.getContent().toString();
    let manifest: EvidenceManifest;
    try {
        manifest = JSON.parse(manifestContent);
    } catch {
        return undefined;
    }
    if (
        !manifest?.capture?.captureId ||
        !manifest.snapshot?.sha256 ||
        typeof manifest.payloadSha256 !== "string"
    )
        return undefined;
    const integrity =
        sha256(manifestContent) === note.getOwnedLabelValue("evidenceManifestSha256") &&
        sha256(snapshot.getContent()) === manifest.snapshot.sha256 &&
        manifest.payloadSha256 === note.getOwnedLabelValue("evidencePayloadSha256")
            ? "verified"
            : "changed";
    const receipt: EvidenceReceipt = {
        captureId: manifest.capture.captureId,
        noteId: note.noteId,
        payloadSha256: manifest.payloadSha256,
        snapshotAttachmentId: snapshot.attachmentId,
        manifestAttachmentId: attachment.attachmentId,
        replayed: true
    };
    return { receipt, manifest, integrity };
}

function sha256(value: string | Uint8Array) {
    return createHash("sha256").update(value).digest("hex");
}
