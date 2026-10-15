import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, appendFile, readFile, truncate, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCatalog } from "./source.mjs";
import { startServer } from "./server.mjs";

export async function fixture(t) {
    const home = await mkdtemp(join(tmpdir(), "screenshots-test-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    const db = new DatabaseSync(join(home, "data.db"));
    db.exec(`
        CREATE TABLE sessions (id TEXT, title TEXT, session_type TEXT, updated_at TEXT, archived_at TEXT, execution_location TEXT);
        CREATE TABLE workspaces (id TEXT, name TEXT, project_id TEXT, session_id TEXT, creator_session_id TEXT, archived_at TEXT);
        CREATE TABLE projects (id TEXT, name TEXT);
        CREATE TABLE workspace_session_aliases (session_id TEXT, workspace_id TEXT);
        INSERT INTO sessions VALUES ('current', 'Current', 'workspace', '2026-10-14', NULL, 'local');
        INSERT INTO workspaces VALUES ('workspace', 'Gallery work', 'project', 'current', NULL, NULL);
        INSERT INTO projects VALUES ('project', 'Canvas apps');
        INSERT INTO workspace_session_aliases VALUES ('previous', 'workspace');
    `);
    db.close();
    async function events(id, entries) {
        const directory = join(home, "session-state", id);
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "events.jsonl"), entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    }

    const image = join(home, "example.png");
    await writeFile(image, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"));
    return { home, events, image, catalog: createCatalog({ home }) };
}

test("workspace aliases retain uploaded and successful tool image references without duplicate sessions", async (t) => {
    const { home, events, image, catalog } = await fixture(t);
    await events("previous", [
        { type: "user.message", timestamp: "2026-10-13T10:00:00Z", data: { attachments: [{ type: "file", path: image }] } },
    ]);
    await events("current", [
        { type: "session.start", data: { context: { cwd: home } } },
        { type: "tool.execution_start", data: { toolCallId: "shot", toolName: "playwright-browser_take_screenshot", arguments: { filename: "missing.png" } } },
        { type: "tool.execution_complete", timestamp: "2026-10-14T10:00:00Z", data: { toolCallId: "shot", success: true, result: { content: "### Result\n- [Screenshot](missing.png)" } } },
    ]);
    const sessions = catalog.sessions();
    assert.equal(sessions.sessions.length, 1);
    assert.equal(sessions.sessions[0].name, "Gallery work");
    const result = await catalog.images("current");
    assert.equal(result.images.length, 2);
    assert.equal(result.images.find((item) => item.source === "uploaded").availability, "available");
    assert.equal(result.images.find((item) => item.source === "generated").availability, "missing");
    assert.equal(result.images.find((item) => item.source === "uploaded").width, 1);
});

test("child scope excludes archives, deduplicates references, and never reads failed-tool paths", async (t) => {
    const { home, events, image, catalog } = await fixture(t);
    const db = new DatabaseSync(join(home, "data.db"));
    db.exec(`
        INSERT INTO sessions VALUES ('child', 'Child', 'side_chat', NULL, NULL, 'local');
        INSERT INTO sessions VALUES ('archived', 'Archived child', 'side_chat', NULL, '2026-10-13', 'local');
        INSERT INTO sessions VALUES ('unrelated', 'Other', 'general_chat', NULL, NULL, 'local');
        CREATE TABLE session_side_chats (session_id TEXT, parent_session_id TEXT);
        INSERT INTO session_side_chats VALUES ('child', 'workspace'), ('archived', 'workspace');
    `);
    db.close();
    const upload = { type: "user.message", data: { attachments: [{ type: "file", path: image }] } };
    await events("current", [upload, upload,
        { type: "tool.execution_start", data: { toolCallId: "failed", toolName: "screenshot", arguments: { filename: "failed.png" } } },
        { type: "tool.execution_complete", data: { toolCallId: "failed", success: false } },
    ]);
    await events("child", [upload]);
    await events("archived", [upload]);
    await events("unrelated", [upload]);
    assert.equal((await catalog.images("current")).images.length, 1);
    const children = await catalog.images("current", { includeChildren: true });
    assert.deepEqual(children.images.map((item) => item.sessionId), ["current", "child"]);
    assert.equal(children.warnings.length, 0);
    assert.equal((await catalog.images("current", { includeChildren: true, includeArchived: true })).images.length, 3);
});

test("image delivery uses indexed passive images and rejects changed files, remote URLs, and corrupt headers", async (t) => {
    const { home, events, image, catalog } = await fixture(t);
    const corrupt = join(home, "not-an-image.png");
    await writeFile(corrupt, "<html>not an image</html>");
    await events("current", [{ type: "user.message", data: { attachments: [
        { type: "file", path: image }, { type: "file", path: corrupt },
        { type: "file", path: "https://example.com/remote.png" },
        { type: "file", path: "\\\\server\\private\\image.png" },
        { type: "file", path: join(home, "active.svg") },
    ] } }]);
    const result = await catalog.images("current");
    const available = result.images.find((row) => row.availability === "available");
    assert.equal(result.images.length, 4);
    assert.equal(result.images.find((row) => row.name === "not-an-image.png").availability, "unavailable");
    assert.equal(result.images.filter((row) => row.path === null).length, 2);
    assert.equal(Object.hasOwn(available, "realPath"), false);
    const opened = await catalog.openImage(available.id);
    assert.equal(opened.mime, "image/png");
    await opened.file.close();
    await assert.rejects(catalog.openImage("../not-an-id"), /unavailable/);
    await writeFile(image, "changed");
    await assert.rejects(catalog.openImage(available.id), /changed/);
    assert.equal(catalog.metadata(available.id).id, available.id);
});

test("fallback time and incomplete histories are labeled, and remote sessions are not scanned", async (t) => {
    const { home, events, image, catalog } = await fixture(t);
    await events("current", [{ type: "user.message", data: { attachments: [
        { type: "file", path: image }, { type: "blob", mimeType: "image/png" },
    ] } }]);
    await appendFile(join(home, "session-state", "current", "events.jsonl"), "{\"type\":");
    const result = await catalog.images("current");
    assert.equal(result.images.find((item) => item.path === image).timestampBasis, "file modified");
    assert.equal(result.images.find((item) => item.path === null).timestampBasis, "unknown");
    assert.ok(result.warnings.some((warning) => /incomplete/.test(warning)));
    const db = new DatabaseSync(join(home, "data.db"));
    db.exec("UPDATE sessions SET execution_location = 'cloud'");
    db.close();
    catalog.sessions();
    const remote = await catalog.images("current");
    assert.equal(remote.images.length, 0);
    assert.ok(remote.warnings.some((warning) => /cloud/.test(warning)));
});

test("HTTP serves exactly the indexed image bytes without changing source metadata or files", async (t) => {
    const { home, events, image, catalog } = await fixture(t);
    await events("current", [{ type: "user.message", data: { attachments: [{ type: "file", path: image }] } }]);
    const originalDatabase = await readFile(join(home, "data.db"));
    const originalImage = await readFile(image);
    const server = await startServer(catalog);
    t.after(() => server.close());
    await fetch(new URL("api/sessions", server.url));
    const result = await (await fetch(new URL("api/images?sessionId=current", server.url))).json();
    const id = result.images[0].id;
    const response = await fetch(new URL(`image/${id}`, server.url));
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), originalImage);
    assert.deepEqual(await readFile(join(home, "data.db")), originalDatabase);
    assert.deepEqual(await readFile(image), originalImage);
    await writeFile(image, "replacement");
    assert.equal((await fetch(new URL(`image/${id}`, server.url))).status, 409);
});

test("history and image size limits produce explicit warnings and unavailable records", async (t) => {
    const { home, events, image, catalog } = await fixture(t);
    await events("current", []);
    await truncate(join(home, "session-state", "current", "events.jsonl"), 64 * 1024 * 1024 + 1);
    const largeHistory = await catalog.images("current");
    assert.equal(largeHistory.images.length, 0);
    assert.ok(largeHistory.warnings.some((warning) => /64 MiB/.test(warning)));
    await events("current", [{ type: "user.message", data: { attachments: [{ type: "file", path: image }] } }]);
    await truncate(image, 32 * 1024 * 1024 + 1);
    const largeImage = await catalog.images("current");
    assert.equal(largeImage.images[0].availability, "unavailable");
    assert.match(largeImage.images[0].reason, /32 MiB/);
});
