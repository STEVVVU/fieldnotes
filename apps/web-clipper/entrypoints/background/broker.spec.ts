import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { MessageBroker } from "./broker";

afterEach(() => vi.useRealTimers());

describe("message authorization", () => {
    it("trusts only named internal pages and denies content, frames, external senders and malformed messages", () => {
        const broker = new MessageBroker();
        const request = { name: "save-pdf", url: "https://example.org" };
        const popup = {
            id: fakeBrowser.runtime.id,
            url: fakeBrowser.runtime.getURL("/popup.html")
        };
        expect(broker.authorize(request, popup)).toBe(request);
        expect(
            broker.authorize(request, {
                ...popup,
                url: fakeBrowser.runtime.getURL("/options.html")
            })
        ).toBe(request);
        for (const value of [undefined, null, 1, {}, { name: 3 }])
            expect(broker.authorize(value, popup)).toBeUndefined();
        for (const sender of [
            {},
            { ...popup, id: "other" },
            { ...popup, url: "https://example.org/popup.html" },
            { ...popup, tab: { id: 7 } },
            { ...popup, url: fakeBrowser.runtime.getURL("/offscreen.html") }
        ]) {
            expect(broker.authorize(request, sender)).toBeUndefined();
        }
    });

    it("issues one-use toast grants scoped to the exact tab, top frame, source and action", () => {
        const broker = new MessageBroker();
        const tab = { id: 7, url: "https://example.org" };
        const sender = { id: fakeBrowser.runtime.id, tab, frameId: 0, url: tab.url };
        const action = { name: "closeTabs", tabIds: [8, 9] } as const;
        const grant = broker.issue(tab, { name: "closeTabs", tabIds: [...action.tabIds] });
        const request = { name: "redeem-toast", grant, tabIds: [100] };
        for (const invalid of [
            { name: "redeem-toast" },
            { name: "redeem-toast", grant: "forged" },
            { name: "closeTabs", tabIds: [100] }
        ]) {
            expect(broker.authorize(invalid, sender)).toBeUndefined();
        }
        for (const invalid of [
            { ...sender, tab: { id: 8 } },
            { ...sender, frameId: 1 },
            { ...sender, url: "https://changed.org" },
            { ...sender, tab: undefined }
        ]) {
            expect(broker.authorize(request, invalid)).toBeUndefined();
        }
        expect(broker.authorize(request, sender)).toEqual(action);
        expect(broker.authorize(request, sender)).toBeUndefined();
        expect(new MessageBroker().authorize(request, sender)).toBeUndefined();
    });

    it("expires old grants and evicts the oldest when capacity is reached", () => {
        vi.useFakeTimers();
        const broker = new MessageBroker();
        const tab = { id: 7, url: "https://example.org" };
        const sender = { id: fakeBrowser.runtime.id, tab, frameId: 0, url: tab.url };
        const first = broker.issue(tab, { name: "openNoteInTrilium", noteId: "first" });
        for (let i = 0; i < 64; i++)
            broker.issue(tab, { name: "openNoteInTrilium", noteId: String(i) });
        expect(broker.authorize({ name: "redeem-toast", grant: first }, sender)).toBeUndefined();
        const last = broker.issue(tab, { name: "openNoteInTrilium", noteId: "last" });
        vi.advanceTimersByTime(60001);
        expect(broker.authorize({ name: "redeem-toast", grant: last }, sender)).toBeUndefined();
        broker.issue(tab, { name: "openNoteInTrilium", noteId: "fresh" });
    });
});
