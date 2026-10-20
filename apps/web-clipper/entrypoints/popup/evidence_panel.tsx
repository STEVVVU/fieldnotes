import type { EvidencePreview } from "@triliumnext/commons/src/lib/evidence_capture";
import { useState } from "preact/hooks";

import { describeError } from "@/utils";

import "./evidence_panel.css";

type State = { status: "idle" } | { status: "reading" } | { status: "error"; message: string }
    | { status: "preview" | "saving"; capture: EvidencePreview }
    | { status: "save-error"; capture: EvidencePreview; message: string }
    | { status: "saved"; noteId: string };

export function EvidencePanel({ mode, disabled }: { mode: "article" | "selection"; disabled: boolean }) {
    const [state, setState] = useState<State>({ status: "idle" });

    async function prepare() {
        setState({ status: "reading" });
        try {
            const result = await browser.runtime.sendMessage({ name: "prepare-evidence", mode });
            if (!result || result.error || result.schemaVersion !== 1) throw new Error(result?.error ?? "The background script did not return an evidence preview.");
            setState({ status: "preview", capture: result });
        } catch (error) { setState({ status: "error", message: describeError(error) }); }
    }

    async function preserve(capture: EvidencePreview) {
        setState({ status: "saving", capture });
        try {
            const result = await browser.runtime.sendMessage({ name: "commit-evidence", captureId: capture.captureId, contentSha256: capture.contentSha256 });
            if (!result?.noteId || result.error) throw new Error(result?.error ?? "No save receipt arrived. Retry this capture to recover its receipt.");
            setState({ status: "saved", noteId: result.noteId });
        } catch (error) { setState({ status: "save-error", capture, message: describeError(error) }); }
    }

    return <section className="evidence-panel" aria-label="Evidence capture">
        <h2>Preserve evidence</h2>
        <p>Save a separate snapshot and manifest. Images stay in the missing-asset ledger. Your title edits and notes above are not part of this capture.</p>
        {(state.status === "idle" || state.status === "error" || state.status === "reading") && <button className="btn"
            disabled={disabled || state.status === "reading"}
            title={disabled ? "This action can't be performed without active connection to Trilium." : undefined} onClick={prepare}>
            {state.status === "reading" ? "Reading evidence…" : `Preview ${mode} evidence`}
        </button>}
        {(state.status === "error" || state.status === "save-error") && <p role="alert">{state.message}</p>}
        {(state.status === "preview" || state.status === "saving" || state.status === "save-error") && <>
            <dl>
                <dt>Source</dt><dd>{state.capture.sourceUrl}</dd>
                <dt>Destination</dt><dd>{state.capture.destination}</dd>
                <dt>Captured</dt><dd>{state.capture.capturedAt}</dd>
                <dt>SHA-256</dt><dd><code>{state.capture.contentSha256}</code></dd>
            </dl>
            <details><summary>Exact captured HTML</summary><pre>{state.capture.content}</pre></details>
            <p>The saved note displays an inert text conversion. The attachment preserves this HTML as a text file.</p>
            <div className="evidence-actions">
                <button className="btn btn-primary" disabled={disabled || state.status === "saving"} onClick={() => preserve(state.capture)}>
                    {state.status === "saving" ? "Preserving…" : state.status === "save-error" ? "Retry this capture" : "Preserve this capture"}
                </button>
                <button className="btn" disabled={state.status === "saving"} onClick={() => setState({ status: "idle" })}>Cancel</button>
            </div>
        </>}
        {state.status === "saved" && <p role="status">Snapshot and manifest saved. <button className="btn" onClick={() => browser.runtime.sendMessage({ name: "openNoteInTrilium", noteId: state.noteId })}>Open evidence note</button></p>}
    </section>;
}
