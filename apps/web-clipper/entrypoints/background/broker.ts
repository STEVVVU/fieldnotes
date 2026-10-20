type ToastAction =
    | { name: "openNoteInTrilium"; noteId: string }
    | { name: "closeTabs"; tabIds: number[] };
type Grant = { nonce: string; tabId: number; url: string; expiresAt: number; action: ToastAction };
type Sender = { id?: string; url?: string; frameId?: number; tab?: { id?: number } };

export class MessageBroker {
    private grants: Grant[] = [];

    issue(tab: { id: number; url: string }, action: ToastAction) {
        this.grants = this.grants.filter((grant) => grant.expiresAt > Date.now()).slice(-63);
        const nonce = Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
            byte.toString(16).padStart(2, "0")
        ).join("");
        this.grants.push({
            nonce,
            tabId: tab.id,
            url: tab.url,
            expiresAt: Date.now() + 60000,
            action
        });
        return nonce;
    }

    authorize(request: unknown, sender: Sender): Record<string, unknown> | undefined {
        if (
            !request ||
            typeof request !== "object" ||
            !("name" in request) ||
            typeof request.name !== "string" ||
            sender.id !== browser.runtime.id
        )
            return undefined;
        const message = request as Record<string, unknown>;
        if (
            !sender.tab &&
            (sender.url === browser.runtime.getURL("/popup.html") ||
                sender.url === browser.runtime.getURL("/options.html"))
        )
            return message;
        if (message.name !== "redeem-toast" || typeof message.grant !== "string") return undefined;
        const grant = this.grants.find((candidate) => candidate.nonce === message.grant);
        if (
            !grant ||
            grant.expiresAt <= Date.now() ||
            sender.tab?.id !== grant.tabId ||
            sender.frameId !== 0 ||
            sender.url !== grant.url
        )
            return undefined;
        this.grants = this.grants.filter((candidate) => candidate.nonce !== grant.nonce);
        return grant.action;
    }
}
