import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { EvidenceCaptures } from "./evidence";

let page: unknown;
let tab: { id?: number; url?: string; title?: string };
let documentId: string | undefined;
let scriptResult: unknown;
const service = {
    getDestinationIdentity: vi.fn(async () => "Server https://notes.example.org"),
    callService: vi.fn(
        async (
            method: string,
            _path: string,
            _body?: object,
            _expectedDestination?: string
        ): Promise<unknown> =>
            method === "GET" ? { evidenceCaptureVersion: 1 } : { noteId: "saved" }
    )
};
const executeScript = vi.fn(async ({ args, func }: { args?: string[]; func?: () => unknown }) => {
    if (args) return [{ result: page }];
    if (!func) return [];
    func();
    return [{ result: scriptResult, documentId }];
});

beforeEach(() => {
    fakeBrowser.reset();
    tab = { id: 7, url: "https://example.org/page", title: "Browser title" };
    page = {
        content: '<p>Δ finding</p><img src="i1">',
        images: [{ imageId: "i1", src: 'https://assets.org/?a=1&b="$&"' }]
    };
    documentId = "document-1";
    scriptResult = tab.url;
    Object.assign(fakeBrowser.tabs, {
        query: vi.fn(async () => [tab]),
        sendMessage: vi.fn(async () => page)
    });
    Object.assign(fakeBrowser, { scripting: { executeScript } });
    vi.stubGlobal("crypto", webcrypto);
    service.callService.mockImplementation(async (method) =>
        method === "GET" ? { evidenceCaptureVersion: 1 } : { noteId: "saved" }
    );
});
afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe("evidence transaction", () => {
    it("takes source identity from the browser, binds confirmation to exact bytes and retries the same record", async () => {
        const captures = new EvidenceCaptures(service);
        const preview = await captures.prepare("article");
        expect(preview).toMatchObject({
            sourceUrl: tab.url,
            title: "Browser title",
            mode: "article",
            extractor: "defuddle/0.19.5"
        });
        expect(preview.content).toContain("https://assets.org/?a=1&amp;b=&quot;$&amp;&quot;");
        expect(preview.captureId).toMatch(/^[a-f0-9]{32}$/);
        expect(preview.contentSha256).toHaveLength(64);
        await expect(captures.commit(preview.captureId, "wrong")).rejects.toThrow("digest");
        await expect(
            captures.commit(preview.captureId, preview.contentSha256)
        ).resolves.toMatchObject({ noteId: "saved" });
        await captures.commit(preview.captureId, preview.contentSha256);
        const { destination, ...payload } = preview;
        expect(
            service.callService.mock.calls
                .filter(([method]) => method === "POST")
                .map(([, , body, bound]) => ({ body, bound }))
        ).toEqual([
            { body: payload, bound: destination },
            { body: payload, bound: destination }
        ]);
        expect(service.callService).toHaveBeenCalledWith(
            "GET",
            "evidence-capabilities",
            undefined,
            destination
        );
        await expect(
            new EvidenceCaptures(service).commit(preview.captureId, preview.contentSha256)
        ).rejects.toThrow("expired");
    });

    it("supports selection and fallback titles, and fails closed without a document identity", async () => {
        tab.title = "";
        const captures = new EvidenceCaptures(service);
        const preview = await captures.prepare("selection");
        expect(preview).toMatchObject({
            title: tab.url,
            mode: "selection",
            extractor: "dom-selection/1"
        });
        expect(fakeBrowser.tabs.sendMessage).toHaveBeenCalledWith(7, {
            name: "trilium-save-selection"
        });
        await captures.commit(preview.captureId, preview.contentSha256);
        for (const missing of [undefined, ""]) {
            documentId = missing;
            await expect(captures.prepare("selection")).rejects.toThrow("document IDs");
        }
    });

    it("rejects unsupported modes and servers, unavailable tabs, unsafe URLs and unreadable documents", async () => {
        const captures = new EvidenceCaptures(service);
        await expect(captures.prepare("pdf")).rejects.toThrow("Choose");
        service.callService.mockResolvedValueOnce(undefined);
        await expect(captures.prepare("article")).rejects.toThrow("does not support");
        for (const invalid of [
            {},
            { id: 7 },
            { id: 7, url: "file:///private" },
            { id: 7, url: "https://user:secret@example.org" }
        ]) {
            tab = invalid;
            await expect(captures.prepare("article")).rejects.toThrow();
        }
        Object.assign(fakeBrowser.tabs, { query: vi.fn(async () => []) });
        await expect(captures.prepare("article")).rejects.toThrow("requires");
        Object.assign(fakeBrowser.tabs, {
            query: vi.fn(async () => [{ id: 7, url: "https://example.org" }])
        });
        executeScript.mockResolvedValueOnce([]);
        await expect(captures.prepare("article")).rejects.toThrow("cannot be read");
        await expect(captures.prepare("article")).rejects.toThrow("cannot be read");
    });

    it("rejects malformed, excessive or invalid-Unicode content", async () => {
        const captures = new EvidenceCaptures(service);
        for (const invalid of [
            undefined,
            3,
            {},
            { content: 3 },
            { content: " " },
            { content: "x", images: null },
            { content: "x", images: [null] },
            { content: "x", images: [3] },
            { content: "x", images: [{ imageId: 2, src: "https://example.org" }] },
            { content: "x", images: [{ imageId: "id", src: 3 }] },
            { content: "x".repeat(1024 * 1024 + 1), images: [] },
            { content: "\ud800", images: [] }
        ]) {
            page = invalid;
            await expect(captures.prepare("article")).rejects.toThrow();
        }
    });

    it("rejects navigation during capture and after preview, including same-URL document changes", async () => {
        const captures = new EvidenceCaptures(service);
        executeScript.mockImplementationOnce(async () => {
            documentId = "before";
            return [{ result: tab.url, documentId }];
        });
        executeScript.mockImplementationOnce(async () => {
            documentId = "after";
            return [];
        });
        await expect(captures.prepare("article")).rejects.toThrow("changed during");
        const preview = await captures.prepare("article");
        documentId = "different";
        await expect(captures.commit(preview.captureId, preview.contentSha256)).rejects.toThrow(
            "changed after"
        );
        expect(service.callService.mock.calls.some(([method]) => method === "POST")).toBe(false);
    });

    it("expires previews and evicts old pending captures within a bounded queue", async () => {
        vi.useFakeTimers();
        const captures = new EvidenceCaptures(service);
        const first = await captures.prepare("article");
        for (let i = 0; i < 8; i++) await captures.prepare("article");
        await expect(captures.commit(first.captureId, first.contentSha256)).rejects.toThrow(
            "expired"
        );
        const last = await captures.prepare("article");
        vi.advanceTimersByTime(600001);
        await expect(captures.commit(last.captureId, last.contentSha256)).rejects.toThrow(
            "expired"
        );
        await captures.prepare("article");
    });
});
