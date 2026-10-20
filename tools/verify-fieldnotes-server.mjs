import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runName = process.argv[2];
const port = Number(process.argv[3] ?? 8097);
assert(runName && /^[a-zA-Z0-9_-]+$/.test(runName), "Use a unique run name");
assert(Number.isSafeInteger(port) && port > 1024 && port < 65536, "Invalid port");
const run = path.join(root, ".audit", "verification", runName);
const data = path.join(run, "data");
const base = `http://127.0.0.1:${port}`;
const evidence = { runName, base, startedAt: new Date().toISOString(), actions: [] };
let server;
let authToken;
let createdNote;

await assertPortFree();
await mkdir(run, { recursive: true });
await mkdir(data);
await copyFile(path.join(root, "packages/trilium-core/src/test/fixtures/document.db"), path.join(data, "document.db"));
const transcript = createWriteStream(path.join(run, "server.log"), { flags: "a" });
try {
    await launch();
    await doctor();
    console.log(`READY ${base}; commands: doctor, drive, restart, verify, cleanup`);
    const input = readline.createInterface({ input: process.stdin, output: process.stdout });
    for await (const line of input) {
        const command = line.trim();
        if (command === "cleanup") break;
        if (command === "doctor") await doctor();
        else if (command === "drive") await drive();
        else if (command === "verify") await verify();
        else if (command === "restart") {
            await stop();
            await launch();
            await doctor();
            await verify();
        } else console.log("Use doctor, drive, restart, verify, or cleanup");
    }
    input.close();
} catch (error) {
    evidence.error = String(error);
    process.exitCode = 1;
    console.error(error);
} finally {
    await stop();
    await assertPortFree();
    evidence.cleanup = { listenerStopped: true, finishedAt: new Date().toISOString(), retainedData: data };
    transcript.end();
    await writeFile(path.join(run, "result.json"), JSON.stringify(evidence, null, 2));
    console.log(`Evidence retained at ${run}`);
}

async function launch() {
    const env = { ...process.env, NODE_ENV: "development", TRILIUM_ENV: "dev", TRILIUM_DATA_DIR: data,
        TRILIUM_RESOURCE_DIR: path.join(root, "apps/server/src"), TRILIUM_HOST: "127.0.0.1", TRILIUM_PORT: String(port) };
    for (const key of ["TRILIUM_INTEGRATION_TEST", "TRILIUM_DOCUMENT_PATH", "TRILIUM_CONFIG_INI_PATH", "TRILIUM_NO_AUTHENTICATION"]) delete env[key];
    server = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
        cwd: path.join(root, "apps/server"), env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true
    });
    server.on("error", (error) => console.error(error));
    server.stdout.pipe(transcript, { end: false });
    server.stderr.pipe(transcript, { end: false });
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
        assert(server.exitCode === null, `Server exited with ${server.exitCode}; inspect server.log`);
        try {
            const response = await fetch(`${base}/api/setup/status`, { signal: AbortSignal.timeout(1000) });
            if (response.ok && (await response.json()).isInitialized) {
                evidence.actions.push({ action: "launch", pid: server.pid, at: new Date().toISOString() });
                return;
            }
        } catch (error) {
            if (!(error instanceof TypeError) && error?.name !== "TimeoutError") throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error("Application did not initialize within 90 seconds; inspect server.log");
}

async function doctor() {
    assert(server && server.exitCode === null, "Owned server is not running");
    const denied = await fetch(`${base}/etapi/app-info`);
    assert.equal(denied.status, 401, "ETAPI must require authentication");
    const login = await fetch(`${base}/etapi/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "demo1234" }) });
    assert.equal(login.status, 201, "Synthetic fixture login failed");
    authToken = (await login.json()).authToken;
    assert.equal(typeof authToken, "string");
    const info = await api("/etapi/app-info");
    const status = await (await fetch(`${base}/api/setup/status`)).json();
    assert.equal(status.isInitialized, true);
    evidence.actions.push({ action: "doctor", authRequired: true, initialized: true, appVersion: info.appVersion });
    console.log("DOCTOR passed: initialized fixture, authenticated ETAPI, anonymous requests denied");
}

async function drive() {
    const content = `<p>Fieldnotes verification ${runName}: preserved through restart.</p>`;
    const result = await api("/etapi/create-note", { method: "POST", body: JSON.stringify({
        parentNoteId: "root", title: `Fieldnotes verification ${runName}`, type: "text", content
    }) });
    createdNote = { id: result.note.noteId, title: result.note.title, content };
    evidence.actions.push({ action: "create-note", noteId: createdNote.id, title: createdNote.title });
    await verify();
}

async function verify() {
    assert(createdNote, "Run drive before verify or restart");
    const note = await api(`/etapi/notes/${createdNote.id}`);
    const response = await fetch(`${base}/etapi/notes/${createdNote.id}/content`, { headers: { Authorization: authToken } });
    assert.equal(response.status, 200);
    const content = await response.text();
    assert.equal(note.title, createdNote.title);
    assert.equal(content, createdNote.content);
    evidence.actions.push({ action: "read-note", noteId: note.noteId, contentSha256: createHash("sha256").update(content).digest("hex") });
    console.log(`DRIVE passed: ${note.noteId} content and title read through public ETAPI`);
}

async function api(route, options = {}) {
    const response = await fetch(`${base}${route}`, { ...options, headers: { Authorization: authToken, "Content-Type": "application/json" } });
    assert(response.ok, `${route} returned ${response.status}`);
    return response.json();
}

async function stop() {
    if (!server) return;
    if (server.exitCode === null) {
        if (process.platform === "win32") {
            const killer = spawn("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
            const [code] = await once(killer, "exit");
            assert.equal(code, 0, "Failed to stop owned server tree");
        } else server.kill("SIGTERM");
        if (server.exitCode === null) await once(server, "exit");
    }
    server = undefined;
    await assertPortFree();
}

async function assertPortFree() {
    const socket = net.connect({ host: "127.0.0.1", port });
    const occupied = await new Promise((resolve, reject) => {
        socket.once("connect", () => { socket.destroy(); resolve(true); });
        socket.once("error", (error) => error.code === "ECONNREFUSED" ? resolve(false) : reject(error));
    });
    assert.equal(occupied, false, `Port ${port} is occupied`);
}
