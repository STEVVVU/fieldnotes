export interface EvidenceCapture {
    schemaVersion: 1;
    captureId: string;
    mode: "article" | "selection";
    sourceUrl: string;
    title: string;
    capturedAt: string;
    extractor: string;
    content: string;
    contentSha256: string;
}

export interface EvidenceReceipt {
    captureId: string;
    noteId: string;
    payloadSha256: string;
    snapshotAttachmentId: string;
    manifestAttachmentId: string;
    replayed: boolean;
}

export interface EvidencePreview extends EvidenceCapture {
    destination: string;
}

export interface EvidenceManifest {
    schemaVersion: 1;
    capture: Omit<EvidenceCapture, "content">;
    receivedAt: string;
    payloadSha256: string;
    snapshot: { sha256: string; bytes: number; encoding: "utf-8"; mime: "text/html" };
    assets: { url: string; status: "not-captured" }[];
    transformations: ["html-to-inert-text"];
}
