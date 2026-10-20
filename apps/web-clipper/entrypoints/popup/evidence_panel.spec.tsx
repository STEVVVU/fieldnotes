import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { EvidencePanel } from "./evidence_panel";

const capture = { schemaVersion: 1, captureId: "a".repeat(32), mode: "article", sourceUrl: "https://example.org/research",
    title: "Finding", capturedAt: "2026-10-20T00:00:00.000Z", content: '<img src=x onerror="alert(1)">', contentSha256: "b".repeat(64), destination: "Server https://notes.example.org" };
const send = vi.fn(async (_message: object): Promise<unknown> => capture);
let container: HTMLDivElement;

beforeEach(() => {
    fakeBrowser.reset();
    Object.assign(fakeBrowser.runtime, { sendMessage: send });
    container = document.createElement("div");
    document.body.append(container);
    send.mockResolvedValue(capture);
});
afterEach(() => { act(() => render(null, container)); container.remove(); vi.clearAllMocks(); });

describe("evidence preview", () => {
    it("shows the exact inert capture and confirms its ID and digest, then opens the saved note", async () => {
        act(() => render(<EvidencePanel mode="article" disabled={false} />, container));
        await click("Preview article evidence");
        expect(container.querySelector("pre")?.textContent).toBe(capture.content);
        expect(container.querySelector("img")).toBeNull();
        expect(container.textContent).toContain(capture.sourceUrl);
        expect(container.textContent).toContain(capture.contentSha256);
        await click("Cancel");
        await click("Preview article evidence");
        send.mockResolvedValueOnce({ noteId: "saved" });
        await click("Preserve this capture");
        expect(send).toHaveBeenCalledWith({ name: "commit-evidence", captureId: capture.captureId, contentSha256: capture.contentSha256 });
        expect(container.querySelector('[role="status"]')).not.toBeNull();
        await click("Open evidence note");
        expect(send).toHaveBeenLastCalledWith({ name: "openNoteInTrilium", noteId: "saved" });
    });

    it("shows preparation and save failures without claiming that evidence was preserved", async () => {
        act(() => render(<EvidencePanel mode="selection" disabled={false} />, container));
        for (const result of [undefined, { error: "not authorized" }, { schemaVersion: 2 }]) {
            send.mockResolvedValueOnce(result);
            await click("Preview selection evidence");
            expect(container.querySelector('[role="alert"]')).not.toBeNull();
            expect(container.querySelector('[role="status"]')).toBeNull();
        }
        send.mockRejectedValueOnce(new Error("offline"));
        await click("Preview selection evidence");
        expect(container.textContent).toContain("offline");
        for (const result of [undefined, { error: "page changed" }, { noteId: "saved", error: "refused" }]) {
            await click("Preview selection evidence");
            send.mockResolvedValueOnce(result);
            await click("Preserve this capture");
            expect(container.querySelector('[role="alert"]')).not.toBeNull();
            expect(container.querySelector('[role="status"]')).toBeNull();
            await click("Cancel");
        }
    });

    it("retries the same capture after a lost response rather than preparing a duplicate", async () => {
        act(() => render(<EvidencePanel mode="article" disabled={false} />, container));
        await click("Preview article evidence");
        send.mockRejectedValueOnce(new Error("response lost after commit"));
        await click("Preserve this capture");
        expect(container.textContent).toContain(capture.destination);
        send.mockResolvedValueOnce({ noteId: "original-receipt" });
        await click("Retry this capture");
        expect(send.mock.calls.map(([message]) => message)).toEqual([
            { name: "prepare-evidence", mode: "article" },
            { name: "commit-evidence", captureId: capture.captureId, contentSha256: capture.contentSha256 },
            { name: "commit-evidence", captureId: capture.captureId, contentSha256: capture.contentSha256 }
        ]);
        expect(container.querySelector('[role="status"]')).not.toBeNull();
    });

    it("disables actions while disconnected, reading or saving", async () => {
        act(() => render(<EvidencePanel mode="article" disabled={true} />, container));
        expect(button("Preview article evidence").disabled).toBe(true);
        act(() => render(<EvidencePanel mode="article" disabled={false} />, container));
        let finish: (value: unknown) => void = () => {};
        send.mockReturnValueOnce(new Promise((resolve) => finish = resolve));
        await click("Preview article evidence");
        expect(button("Reading evidence…").disabled).toBe(true);
        await act(async () => { finish(capture); });
        send.mockReturnValueOnce(new Promise((resolve) => finish = resolve));
        await click("Preserve this capture");
        expect(button("Preserving…").disabled).toBe(true);
        expect(button("Cancel").disabled).toBe(true);
        await act(async () => { finish({ noteId: "saved" }); });
    });
});

function button(text: string) {
    const found = Array.from(container.querySelectorAll("button")).find((element) => element.textContent === text);
    if (!found) throw new Error(`Button not found: ${text}`);
    return found;
}

async function click(text: string) {
    await act(async () => { button(text).click(); });
}
