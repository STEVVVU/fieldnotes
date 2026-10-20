import type { EvidenceCapture } from "@triliumnext/commons/src/lib/evidence_capture";

import { extractPage } from "@/utils";

type PageContent = { content: string; images: { imageId: string; src: string }[] };
type PendingCapture = {
    capture: EvidenceCapture;
    destination: string;
    tabId: number;
    documentId: string;
    expiresAt: number;
};
type EvidenceService = {
    getDestinationIdentity(): Promise<string>;
    callService(
        method: string,
        path: string,
        body?: object,
        expectedDestination?: string
    ): Promise<unknown>;
};

export class EvidenceCaptures {
    private pending: PendingCapture[] = [];

    constructor(private readonly service: EvidenceService) {}

    async prepare(mode: unknown) {
        if (mode !== "article" && mode !== "selection")
            throw new Error("Choose article or selection evidence.");
        const destination = await this.service.getDestinationIdentity();
        const capabilities = (await this.service.callService(
            "GET",
            "evidence-capabilities",
            undefined,
            destination
        )) as { evidenceCaptureVersion?: number };
        if (capabilities?.evidenceCaptureVersion !== 1)
            throw new Error("This server does not support Fieldnotes evidence capture.");
        const before = await this.currentDocument();
        const reading: unknown =
            mode === "article"
                ? await extractPage(before.tabId, "article")
                : await browser.tabs.sendMessage(before.tabId, { name: "trilium-save-selection" });
        const extracted = parseReading(reading);
        let content = extracted.content;
        for (const image of extracted.images) {
            content = content.replaceAll(image.imageId, () =>
                image.src
                    .replaceAll("&", "&amp;")
                    .replaceAll('"', "&quot;")
                    .replaceAll("<", "&lt;")
                    .replaceAll(">", "&gt;")
            );
        }
        const bytes = new TextEncoder().encode(content);
        if (bytes.byteLength > 1024 * 1024 || !content.isWellFormed())
            throw new Error("Evidence is limited to 1 MiB of valid UTF-8 content.");
        const after = await this.currentDocument();
        if (!sameDocument(before, after))
            throw new Error("The page changed during capture. Capture it again.");
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const capture: EvidenceCapture = {
            schemaVersion: 1,
            captureId: hex(crypto.getRandomValues(new Uint8Array(16))),
            mode,
            sourceUrl: before.url,
            title: before.title.slice(0, 500),
            capturedAt: new Date().toISOString(),
            extractor: mode === "article" ? "defuddle/0.19.5" : "dom-selection/1",
            content,
            contentSha256: hex(new Uint8Array(digest))
        };
        this.pending = this.pending.filter((entry) => entry.expiresAt > Date.now()).slice(-7);
        this.pending.push({
            capture,
            destination,
            tabId: before.tabId,
            documentId: before.documentId,
            expiresAt: Date.now() + 600000
        });
        return { ...capture, destination };
    }

    async commit(captureId: unknown, contentSha256: unknown) {
        const pending = this.pending.find((entry) => entry.capture.captureId === captureId);
        if (!pending || pending.expiresAt <= Date.now())
            throw new Error("Evidence preview expired. Capture the page again.");
        if (pending.capture.contentSha256 !== contentSha256)
            throw new Error("Evidence preview digest does not match.");
        const current = await this.currentDocument();
        if (
            !sameDocument(
                {
                    tabId: pending.tabId,
                    documentId: pending.documentId,
                    url: pending.capture.sourceUrl
                },
                current
            )
        ) {
            throw new Error("The page changed after preview. Capture it again.");
        }
        const result = (await this.service.callService(
            "POST",
            "evidence",
            pending.capture,
            pending.destination
        )) as { noteId: string };
        return {
            noteId: result.noteId,
            message: "Evidence snapshot and manifest have been preserved."
        };
    }

    private async currentDocument() {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.id === undefined || !tab.url || !/^https?:\/\//.test(tab.url))
            throw new Error("Evidence requires an HTTP or HTTPS page.");
        const url = new URL(tab.url);
        if (url.username || url.password)
            throw new Error("Evidence source URLs cannot contain credentials.");
        const [frame] = await browser.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => location.href
        });
        if (!frame || frame.result !== tab.url)
            throw new Error("The page changed or cannot be read.");
        if (typeof frame.documentId !== "string" || !frame.documentId)
            throw new Error("Evidence capture requires a browser that provides document IDs.");
        return {
            tabId: tab.id,
            url: tab.url,
            title: tab.title?.trim() || tab.url,
            documentId: frame.documentId
        };
    }
}

function parseReading(value: unknown): PageContent {
    if (!value || typeof value !== "object") throw new Error("No content to preserve.");
    const fields = value as Record<string, unknown>;
    if (typeof fields.content !== "string") throw new Error("Invalid extracted content.");
    if (!fields.content.trim()) throw new Error("No content to preserve.");
    if (!Array.isArray(fields.images)) throw new Error("Invalid extracted images.");
    const images: PageContent["images"] = [];
    for (const item of fields.images) {
        if (!item || typeof item !== "object") throw new Error("Invalid extracted image metadata.");
        if (typeof item.imageId !== "string" || typeof item.src !== "string")
            throw new Error("Invalid extracted image metadata.");
        images.push({ imageId: item.imageId, src: item.src });
    }
    return { content: fields.content, images };
}

function sameDocument(
    left: { tabId: number; url: string; documentId: string },
    right: { tabId: number; url: string; documentId: string }
) {
    return (
        left.tabId === right.tabId && left.url === right.url && left.documentId === right.documentId
    );
}

function hex(bytes: Uint8Array) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
