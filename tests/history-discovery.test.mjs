import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, appendFile, rm, stat, truncate } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createCatalog as artifactsCatalog } from "../apps/artifacts/source.mjs";
import { createCatalog as screenshotsCatalog } from "../apps/screenshots/source.mjs";

const MiB = 1024 * 1024;
for (const [name, createCatalog, method, field] of [
    ["Artifacts", artifactsCatalog, "artifacts", "artifacts"],
    ["Screenshots", screenshotsCatalog, "images", "images"],
]) {
    test(`${name} discovers early and recent references in histories larger than 64 MiB`, async t => {
        const home = await mkdtemp(join(tmpdir(), "canvas-history-"));
        let catalog;
        t.after(async () => { catalog?.close?.(); await rm(home, { recursive: true, force: true }); });
        const db = new DatabaseSync(join(home, "data.db"));
        db.exec(`
            CREATE TABLE sessions (id TEXT, title TEXT, updated_at TEXT, archived_at TEXT, execution_location TEXT);
            CREATE TABLE workspaces (id TEXT, name TEXT, project_id TEXT, session_id TEXT, creator_session_id TEXT, archived_at TEXT);
            INSERT INTO sessions VALUES ('current', 'Current', NULL, NULL, 'local');
        `);
        db.close();
        const directory = join(home, "session-state", "current");
        await mkdir(directory, { recursive: true });
        const history = join(directory, "events.jsonl");
        const attachment = name => JSON.stringify({
            type: "user.message", data: { attachments: [{ type: "file", path: join(home, name) }] },
        }) + "\n";
        const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
        for (const name of ["early.png", "recent.png"]) await writeFile(join(home, name), bytes);
        await writeFile(history, attachment("early.png"));
        const record = JSON.stringify({ type: "assistant.message", data: { content: "x".repeat(MiB) } }) + "\n";
        for (let index = 0; index < 65; index++) await appendFile(history, record);
        await appendFile(history, attachment("recent.png"));
        assert.ok((await stat(history)).size > 64 * MiB);
        catalog = createCatalog({ home });
        const result = await catalog[method]("current");
        assert.deepEqual(result[field].map(item => item.name).sort(), ["early.png", "recent.png"]);
        assert.deepEqual(result.warnings, []);

        // A single oversized record must not hide the valid record after it.
        await writeFile(history, "");
        await truncate(history, 64 * MiB + 1);
        const assetId = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
        await appendFile(history, "\n" + attachment("recent.png") + [
            { type: "session.binary_asset", data: { assetId, type: "image", mimeType: "image/png", byteLength: bytes.length, data: bytes.toString("base64") } },
            { type: "user.message", data: { attachments: [{ type: "file", path: join(home, "retained.png"), assetId }] } },
        ].map(JSON.stringify).join("\n") + "\n");
        const oversized = await catalog[method]("current");
        assert.deepEqual(oversized[field].map(item => item.name).sort(), ["recent.png", "retained.png"]);
        assert.ok(oversized.warnings.some(warning => /record.*64 MiB.*skipped/.test(warning)));
        const retained = oversized[field].find(item => item.name === "retained.png");
        assert.equal(retained.availability, "available");
        const content = name === "Artifacts" ? (await catalog.read(retained.id)).bytes : (await catalog.openImage(retained.id)).data;
        assert.deepEqual(content, bytes);

        await truncate(history, 128 * MiB + 1);
        const limited = await catalog[method]("current");
        assert.equal(limited[field].length, 0);
        assert.ok(limited.warnings.some(warning => /128 MiB scope budget/.test(warning)));
    });
}
