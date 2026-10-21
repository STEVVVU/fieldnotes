import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect } from "@playwright/test";

assert(process.env.GITHUB_ACTIONS === "true" && process.platform === "darwin",
    "Native window verification runs only on the dedicated macOS hosted runner.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runName = process.argv[2];
assert(runName && /^[A-Za-z0-9_-]{1,60}$/.test(runName), "Use a unique short run name.");
const run = path.join(root, ".audit/verification", runName);
const data = path.join(run, "data");
const port = 8099;
const base = `http://127.0.0.1:${port}`;
const result = { runName, actions: [], nativeAcceptance: false, cleanup: {} };
await portFree();
await mkdir(run, { recursive: true });
await mkdir(data);
await copyFile(path.join(root, "packages/trilium-core/src/test/fixtures/document.db"), path.join(data, "document.db"));
const env = {
    ...process.env,
    NODE_ENV: "production", TRILIUM_ENV: "production", ELECTRON_IS_DEV: "0",
    TRILIUM_DATA_DIR: data, TRILIUM_ELECTRON_DATA_DIR: path.join(run, "electron-profile"),
    TRILIUM_HOST: "127.0.0.1", TRILIUM_PORT: String(port),
    TRILIUM_RESOURCE_DIR: path.join(root, "apps/desktop/dist")
};
for (const key of ["ELECTRON_RUN_AS_NODE", "ELECTRON_OVERRIDE_DIST_PATH", "TRILIUM_INTEGRATION_TEST",
    "TRILIUM_DOCUMENT_PATH", "TRILIUM_CONFIG_INI_PATH"]) delete env[key];

let app;
let page;
const ownedGroups = new Set();
let processOutput = "";
try {
    await launch("initial");
    const content = "<h1>Native evidence fixture</h1><p>Δ retained across desktop restart.</p>";
    const contentSha256 = createHash("sha256").update(content).digest("hex");
    const capture = {
        schemaVersion: 1, captureId: createHash("sha256").update(runName).digest("hex").slice(0, 32),
        mode: "article", sourceUrl: "https://example.org/owned-native-fixture", title: "Native evidence fixture",
        capturedAt: new Date().toISOString(), extractor: "defuddle/0.19.5", content, contentSha256
    };
    const receipt = await request("/api/clipper/evidence", capture);
    const record = await request("/api/clipper/evidence/" + capture.captureId);
    assert.equal(record.integrity, "verified");
    assert.equal(record.manifest.snapshot.sha256, contentSha256);
    result.actions.push({ action: "capture", noteId: receipt.noteId, contentSha256 });
    await showEvidence(receipt.noteId, "captured");
    await stop();
    await portFree();
    result.actions.push({ action: "shutdown-before-reopen" });
    await launch("reopened");
    const restored = await request("/api/clipper/evidence/" + capture.captureId);
    assert.deepEqual(restored, record, "Desktop restart changed the evidence record.");
    await showEvidence(receipt.noteId, "reopened");
    const replay = await request("/api/clipper/evidence", capture);
    assert.equal(replay.replayed, true);
    assert.equal(replay.noteId, receipt.noteId);
    result.actions.push({ action: "native-reopen", exactRecordRetained: true, originalIdReplay: true });
    result.nativeAcceptance = true;
} catch (error) {
    result.error = String(error?.stack ?? error);
    if (page && !page.isClosed()) {
        try {
            await page.screenshot({ path: path.join(run, "failure.png"), timeout: 10000 });
            await writeFile(path.join(run, "failure.html"), await page.content());
        } catch (captureError) {
            result.failureEvidenceError = String(captureError);
        }
    }
    process.exitCode = 1;
} finally {
    try {
        await stop();
        await portFree();
        result.cleanup.processAndListenerStopped = true;
    } catch (cleanupError) {
        result.cleanup.error = String(cleanupError);
        process.exitCode = 1;
    }
    await writeFile(path.join(run, "desktop.log"), processOutput);
    result.cleanup.evidenceRetained = true;
    await writeFile(path.join(run, "native-result.json"), JSON.stringify(result, null, 2));
    if (result.nativeAcceptance) {
        assert((await readFile(path.join(run, "reopened.png"))).subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")));
    }
    console.log("EVIDENCE " + path.join(run, "native-result.json"));
}

async function launch(stage) {
    app = await electron.launch({ args: [path.join(root, "apps/desktop/dist")], cwd: root, env, chromiumSandbox: true, timeout: 60000 });
    const child = app.process();
    assert(Number.isInteger(child.pid) && child.pid > 1);
    ownedGroups.add(child.pid);
    child.stdout?.on("data", chunk => { processOutput += chunk.toString(); });
    child.stderr?.on("data", chunk => { processOutput += chunk.toString(); });
    page = await app.firstWindow({ timeout: 60000 });
    page.on("pageerror", error => { processOutput += `\nRENDERER ${error.stack ?? error}\n`; });
    page.setDefaultTimeout(30000);
    await expect.poll(async () => {
        try {
            const response = await fetch(base + "/api/clipper/handshake", { signal: AbortSignal.timeout(2000) });
            return response.ok;
        } catch (error) {
            if (error instanceof TypeError || error?.name === "TimeoutError") return false;
            throw error;
        }
    }, { timeout: 60000, message: "Real Electron clipper handshake" }).toBe(true);
    await expect(page.locator(".tree-wrapper")).toBeVisible({ timeout: 60000 });
    assert(page.url().startsWith("trilium-app://app/"), "Expected the real desktop custom protocol.");
    assert.equal(await app.evaluate(({ app }) => app.commandLine.hasSwitch("no-sandbox")), false);
    const preferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => {
        const prefs = window.webContents.getLastWebPreferences();
        return { nodeIntegration: prefs.nodeIntegration, contextIsolation: prefs.contextIsolation };
    }));
    assert(preferences.length > 0);
    for (const prefs of preferences) {
        assert.equal(prefs.nodeIntegration, false);
        assert.equal(prefs.contextIsolation, true);
    }
    result.actions.push({ action: "doctor", stage, pid: child.pid, protocol: "trilium-app", preferences });
}

async function showEvidence(noteId, stage) {
    await request("/api/clipper/open/" + encodeURIComponent(noteId), {});
    const split = page.locator(".note-split:not(.hidden-ext)");
    await expect(split.locator(".title-row .note-title")).toHaveValue("Evidence: Native evidence fixture");
    await expect(split.locator(".note-detail-printable.visible")).toContainText("Δ retained across desktop restart.");
    await expect(split.locator(".note-detail-printable.visible")).toContainText("External images are not downloaded.");
    await page.screenshot({ path: path.join(run, stage + ".png") });
    await writeFile(path.join(run, stage + ".html"), await page.content());
    result.actions.push({ action: "render-evidence", stage, noteId, screenshot: stage + ".png" });
}

async function request(route, body) {
    const response = await fetch(base + route, {
        ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10000)
    });
    assert.equal(response.status, 200, `Unexpected response for ${route}`);
    return response.json();
}

async function stop() {
    const owned = app;
    app = undefined;
    try {
        if (owned) await Promise.race([owned.close(), new Promise((_, reject) => {
            const timer = setTimeout(() => reject(new Error("Owned Electron close timed out.")), 30000);
            timer.unref();
        })]);
    } finally {
        for (const pid of ownedGroups) {
            if (groupAlive(pid)) process.kill(-pid, "SIGKILL");
            await expect.poll(() => groupAlive(pid), { timeout: 10000, message: "Owned Electron process group stopped" }).toBe(false);
            ownedGroups.delete(pid);
        }
    }
}

function groupAlive(pid) {
    try {
        process.kill(-pid, 0);
        return true;
    } catch (error) {
        if (error.code === "ESRCH") return false;
        throw error;
    }
}

async function portFree() {
    const occupied = await new Promise((resolve, reject) => {
        const socket = net.connect({ host: "127.0.0.1", port });
        socket.setTimeout(2000, () => { socket.destroy(); reject(new Error("Listener probe timed out.")); });
        socket.once("connect", () => { socket.destroy(); resolve(true); });
        socket.once("error", error => error.code === "ECONNREFUSED" ? resolve(false) : reject(error));
    });
    assert.equal(occupied, false, "Owned desktop port is occupied.");
}
