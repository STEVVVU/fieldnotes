import type { Application } from "express";
import { createHash } from "node:crypto";
import supertest from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

let app: Application;
let token: string;
const content =
    '<h1>Observed result</h1><script>fetch("https://attack.invalid")</script><img src="https://assets.invalid/a.png"><p>Δ research finding</p>';
const capture = {
    schemaVersion: 1,
    captureId: "a".repeat(32),
    mode: "article",
    sourceUrl: "https://example.org/research",
    title: "Research finding",
    capturedAt: "2026-10-20T12:00:00.000Z",
    extractor: "defuddle/0.19.5",
    content,
    contentSha256: createHash("sha256").update(content).digest("hex")
};

beforeAll(async () => {
    app = await (await import("../../app.js")).default();
    const login = await supertest(app)
        .post("/etapi/auth/login")
        .send({ password: "demo1234" })
        .expect(201);
    token = login.body.authToken;
    expect(typeof token).toBe("string");
});

describe("evidence capture HTTP contract", () => {
    it("requires credentials and rejects malformed captures without creating a record", async () => {
        await supertest(app).post("/api/clipper/evidence").send(capture).expect(401);
        for (const invalid of [
            { ...capture, schemaVersion: 2 },
            { ...capture, captureId: "../../notes" },
            { ...capture, contentSha256: "0".repeat(64) },
            { ...capture, sourceUrl: "javascript:alert(1)" },
            { ...capture, sourceUrl: "https://user:secret@example.org" },
            { ...capture, labels: { run: "code" } },
            { ...capture, content: "a".repeat(1024 * 1024 + 1) },
            { ...capture, capturedAt: "yesterday" }
        ]) {
            await supertest(app)
                .post("/api/clipper/evidence")
                .set("Authorization", token)
                .send(invalid)
                .expect(400);
        }
        await supertest(app)
            .get(`/api/clipper/evidence/${capture.captureId}`)
            .set("Authorization", token)
            .expect(404);
    });

    it("preserves exact bytes, returns one receipt for retries and rejects a changed replay", async () => {
        const first = await supertest(app)
            .post("/api/clipper/evidence")
            .set("Authorization", token)
            .send(capture)
            .expect(200);
        expect(first.body.replayed).toBe(false);
        const replay = await supertest(app)
            .post("/api/clipper/evidence")
            .set("Authorization", token)
            .send(capture)
            .expect(200);
        expect(replay.body).toEqual({ ...first.body, replayed: true });
        await supertest(app)
            .post("/api/clipper/evidence")
            .set("Authorization", token)
            .send({ ...capture, title: "changed" })
            .expect(409);
        const snapshot = await supertest(app)
            .get(`/etapi/attachments/${first.body.snapshotAttachmentId}/content`)
            .set("Authorization", token)
            .expect(200);
        expect(snapshot.text).toBe(content);
        const manifestResponse = await supertest(app)
            .get(`/etapi/attachments/${first.body.manifestAttachmentId}/content`)
            .set("Authorization", token)
            .expect(200);
        const manifest = JSON.parse(manifestResponse.text);
        expect(manifest.snapshot).toMatchObject({
            sha256: capture.contentSha256,
            bytes: Buffer.byteLength(content),
            encoding: "utf-8"
        });
        expect(manifest.assets).toEqual([
            { url: "https://assets.invalid/a.png", status: "not-captured" }
        ]);
        const note = await supertest(app)
            .get(`/etapi/notes/${first.body.noteId}/content`)
            .set("Authorization", token)
            .expect(200);
        expect(note.text).toContain("Δ research finding");
        expect(note.text).toContain("Observed result\nΔ research finding");
        expect(note.text).not.toMatch(/<script|<img|<iframe/);
        const record = await supertest(app)
            .get(`/api/clipper/evidence/${capture.captureId}`)
            .set("Authorization", token)
            .expect(200);
        expect(record.body.integrity).toBe("verified");

        const other = await supertest(app)
            .post("/api/clipper/evidence")
            .set("Authorization", token)
            .send({ ...capture, captureId: "b".repeat(32) })
            .expect(200);
        expect(other.body.noteId).not.toBe(first.body.noteId);
        await supertest(app)
            .put(`/etapi/attachments/${first.body.snapshotAttachmentId}/content`)
            .set("Authorization", token)
            .set("Content-Type", "text/plain")
            .send("altered by owner")
            .expect(204);
        const changed = await supertest(app)
            .get(`/api/clipper/evidence/${capture.captureId}`)
            .set("Authorization", token)
            .expect(200);
        expect(changed.body.integrity).toBe("changed");
        await supertest(app)
            .post("/api/clipper/evidence")
            .set("Authorization", token)
            .send(capture)
            .expect(409);
    });
});
