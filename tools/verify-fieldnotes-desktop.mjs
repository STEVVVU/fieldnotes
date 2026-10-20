import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runName = process.argv[2];
assert(runName && /^[a-zA-Z0-9_-]+$/.test(runName), "Use a unique run name");
assert.equal(
    process.platform,
    "win32",
    "This driver currently verifies the Windows Electron build"
);
const run = path.join(root, ".audit/verification", runName);
const data = path.join(run, "data");
const port = Number(process.argv[3] ?? 8099);
assert(Number.isInteger(port) && port > 1024 && port < 65536, "Invalid port");
const evidence = {
    runName,
    port,
    hiddenRequested: true,
    nativeRendering: "unverified",
    startedAt: new Date().toISOString()
};
await portFree();
await mkdir(run, { recursive: true });
await mkdir(data);
await copyFile(
    path.join(root, "packages/trilium-core/src/test/fixtures/document.db"),
    path.join(data, "document.db")
);
const log = createWriteStream(path.join(run, "desktop.log"));
const env = {
    ...process.env,
    NODE_ENV: "production",
    TRILIUM_ENV: "production",
    ELECTRON_IS_DEV: "0",
    TRILIUM_DATA_DIR: data,
    TRILIUM_ELECTRON_DATA_DIR: path.join(run, "electron-profile"),
    TRILIUM_PORT: String(port),
    TRILIUM_HOST: "127.0.0.1",
    TRILIUM_RESOURCE_DIR: path.join(root, "apps/desktop/dist")
};
for (const key of [
    "ELECTRON_RUN_AS_NODE",
    "ELECTRON_OVERRIDE_DIST_PATH",
    "TRILIUM_INTEGRATION_TEST",
    "TRILIUM_DOCUMENT_PATH",
    "TRILIUM_CONFIG_INI_PATH"
])
    delete env[key];
const desktop = spawn(
    path.join(root, "node_modules/electron/dist/electron.exe"),
    [path.join(root, "apps/desktop/dist"), "--start-hidden"],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
);
let launchError;
desktop.once("error", (error) => (launchError = error));
desktop.stdout.pipe(log, { end: false });
desktop.stderr.pipe(log, { end: false });
try {
    const deadline = Date.now() + 60000;
    let handshake;
    while (Date.now() < deadline) {
        if (launchError) throw launchError;
        assert.equal(
            desktop.exitCode,
            null,
            `Electron exited with ${desktop.exitCode}; inspect desktop.log`
        );
        try {
            const response = await fetch(`http://127.0.0.1:${port}/api/clipper/handshake`, {
                signal: AbortSignal.timeout(1000)
            });
            if (response.ok) {
                handshake = await response.json();
                break;
            }
        } catch (error) {
            if (!(error instanceof TypeError) && error?.name !== "TimeoutError") throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert(handshake, "Electron did not expose its loopback clipper within 60 seconds");
    const capabilities = await (
        await fetch(`http://127.0.0.1:${port}/api/clipper/evidence-capabilities`)
    ).json();
    assert.equal(capabilities.evidenceCaptureVersion, 1);
    const content = "<h1>Desktop evidence fixture</h1><p>Δ persisted by Electron.</p>";
    const contentSha256 = createHash("sha256").update(content).digest("hex");
    const capture = {
        schemaVersion: 1,
        captureId: createHash("sha256").update(runName).digest("hex").slice(0, 32),
        mode: "article",
        sourceUrl: "https://example.org/owned-desktop-fixture",
        title: "Desktop evidence fixture",
        capturedAt: new Date().toISOString(),
        extractor: "defuddle/0.19.5",
        content,
        contentSha256
    };
    const saved = await fetch(`http://127.0.0.1:${port}/api/clipper/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(capture)
    });
    assert.equal(saved.status, 200);
    const receipt = await saved.json();
    const record = await (
        await fetch(`http://127.0.0.1:${port}/api/clipper/evidence/${capture.captureId}`)
    ).json();
    assert.equal(record.integrity, "verified");
    assert.equal(record.manifest.snapshot.sha256, contentSha256);
    const deniedHost = await new Promise((resolve, reject) => {
        const request = http.get(
            {
                host: "127.0.0.1",
                port,
                path: "/api/clipper/evidence-capabilities",
                headers: { Host: "unrelated.invalid" }
            },
            (response) => {
                response.resume();
                resolve(response.statusCode);
            }
        );
        request.on("error", reject);
    });
    assert.equal(deniedHost, 403, "Desktop loopback integration must reject an unrelated Host");
    evidence.result = {
        handshake,
        capabilities,
        deniedHost,
        processId: desktop.pid,
        scope: "real Electron main process and HTTP boundary only",
        capture: { noteId: receipt.noteId, integrity: record.integrity, contentSha256 }
    };
    console.log(
        "DESKTOP passed: actual Electron main process, evidence capability and loopback Host boundary"
    );
} catch (error) {
    evidence.error = String(error);
    console.error(error);
    process.exitCode = 1;
} finally {
    if (desktop.pid && desktop.exitCode === null) {
        const stop = spawn("taskkill", ["/PID", String(desktop.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore"
        });
        const [code] = await once(stop, "exit");
        assert.equal(code, 0, "Could not stop the owned Electron process tree");
        if (desktop.exitCode === null) await once(desktop, "exit");
    }
    await portFree();
    if (evidence.result?.capture) {
        const database = new Database(path.join(data, "document.db"), { readonly: true });
        try {
            assert(
                database
                    .prepare("SELECT noteId FROM notes WHERE noteId = ? AND isDeleted = 0")
                    .get(evidence.result.capture.noteId)
            );
            evidence.result.capture.persistedAfterShutdown = true;
        } finally {
            database.close();
        }
    }
    log.end();
    evidence.cleanup = { listenerStopped: true, finishedAt: new Date().toISOString() };
    await writeFile(path.join(run, "desktop-result.json"), JSON.stringify(evidence, null, 2));
    console.log(`Evidence retained at ${run}`);
}

async function portFree() {
    const socket = net.connect({ host: "127.0.0.1", port });
    const occupied = await new Promise((resolve, reject) => {
        socket.once("connect", () => {
            socket.destroy();
            resolve(true);
        });
        socket.once("error", (error) =>
            error.code === "ECONNREFUSED" ? resolve(false) : reject(error)
        );
    });
    assert.equal(occupied, false, `Port ${port} is occupied`);
}
