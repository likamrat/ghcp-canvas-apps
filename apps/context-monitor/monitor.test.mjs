import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextUsage, resolveParents, visibleTree } from "./model.mjs";
import { databasePath, readSnapshot } from "./source.mjs";
import { startServer } from "./server.mjs";

function fixture(t, { optional = true } = {}) {
    const folder = mkdtempSync(join(tmpdir(), "context-monitor-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    const path = join(folder, "data.db");
    const db = new DatabaseSync(path);
    db.exec(`
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY, title TEXT, session_type TEXT, model TEXT,
            context_current_tokens INTEGER, context_input_token_limit INTEGER,
            context_system_tokens INTEGER, is_running INTEGER, updated_at TEXT, archived_at TEXT
        );
        CREATE TABLE workspaces (
            id TEXT PRIMARY KEY, name TEXT, project_id TEXT, session_id TEXT,
            creator_session_id TEXT, archived_at TEXT, updated_at TEXT
        );
        INSERT INTO sessions VALUES
            ('root', 'Root CLI title', 'project', 'test-model', 64000, 100000, 4000, 1, '2026-10-13', NULL),
            ('old-root', 'Historical identity', 'project', 'previous-model', 1000, 100000, NULL, 0, '2026-10-12', NULL),
            ('child', 'Child CLI title', 'project', 'test-model', 85000, 100000, NULL, 0, '2026-10-13', NULL),
            ('chat', 'Standalone chat', 'general_chat', NULL, NULL, NULL, NULL, 0, '2026-10-13', NULL),
            ('orphan', 'Deleted project session', 'project', NULL, NULL, NULL, NULL, 0, '2026-10-13', NULL);
        INSERT INTO workspaces VALUES
            ('root-workspace', 'Root app name', 'project', 'root', NULL, NULL, '2026-10-13'),
            ('child-workspace', 'Child app name', 'project', 'child', 'old-root', '2026-10-13', '2026-10-13'),
            ('pending-workspace', 'Not started', 'project', NULL, NULL, NULL, '2026-10-13');
    `);
    if (optional) db.exec(`
        CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT);
        INSERT INTO projects VALUES ('project', 'Sample project');
        CREATE TABLE workspace_session_aliases (session_id TEXT PRIMARY KEY, workspace_id TEXT);
        INSERT INTO workspace_session_aliases VALUES ('old-root', 'root-workspace');
        CREATE TABLE chat_parent_links (session_id TEXT PRIMARY KEY, parent_session_id TEXT);
        INSERT INTO chat_parent_links VALUES ('chat', 'child-workspace');
        CREATE TABLE session_context_usage (id INTEGER PRIMARY KEY, session_id TEXT, ts_ms INTEGER);
        INSERT INTO session_context_usage VALUES (1, 'root', 1791849600000), (2, 'root', 1791936000000);
    `);
    db.close();
    return path;
}

test("color boundaries use actual utilization, not lifetime usage", () => {
    for (const [used, level] of [[0, "healthy"], [64999, "healthy"], [65000, "watch"], [84999, "watch"], [85000, "high"], [110000, "high"]]) {
        assert.equal(contextUsage(used, 100000).level, level);
    }
    assert.ok(Math.abs(contextUsage(110000, 100000).percent - 110) < 1e-9);
});

test("missing, negative, invalid, or zero capacity is not reported as healthy", () => {
    for (const [used, limit] of [[null, 100], [10, null], [10, 0], [-1, 100], [NaN, 100], [1.5, 100], ["10", 100]]) {
        assert.equal(contextUsage(used, limit).level, "unknown");
        assert.equal(contextUsage(used, limit).percent, null);
    }
    assert.equal(contextUsage(0, 100).percent, 0);
});

test("parent aliases resolve, missing parents promote roots, and cycles stay visible", () => {
    const result = resolveParents([
        { id: "a", name: "A", parentReference: "b" },
        { id: "b", name: "B", parentReference: "old-a" },
        { id: "c", name: "C", parentReference: "missing" },
    ], new Map([["old-a", "a"]]));
    assert.equal(result.warnings.length, 1);
    assert.equal(visibleTree(result.sessions).length, 3);
    assert.equal(result.sessions.find((row) => row.id === "c").parentId, null);
});

const tree = [
    { id: "a", name: "Root", parentId: null },
    { id: "b", name: "Child", parentId: "a" },
    { id: "c", name: "Grandchild", model: "Model X", parentId: "b" },
    { id: "d", name: "Archived", parentId: null, archived: true },
    { id: "e", name: "Visible child", parentId: "d" },
];

test("tree shows arbitrary nesting and collapse affects only descendants", () => {
    const result = visibleTree(tree);
    assert.equal(result.find((row) => row.id === "c").depth, 2);
    assert.deepEqual(visibleTree(tree, { collapsed: new Set(["a"]) }).map((row) => row.id).sort(), ["a", "e"]);
    assert.equal(result.find((row) => row.id === "e").depth, 0);
});

test("search retains ancestors and reveals matches through collapsed parents", () => {
    const result = visibleTree(tree, { search: "model x", collapsed: new Set(["a"]) });
    assert.deepEqual(result.map((row) => row.id), ["a", "b", "c"]);
    assert.equal(result[0].matching, false);
    assert.equal(visibleTree(tree, { search: "no match" }).length, 0);
    assert.equal(visibleTree(tree, { includeArchived: true }).length, 5);
});

test("reads canonical app sessions, aliases, archived parents, and exact token breakdown read-only", (t) => {
    const path = fixture(t);
    const before = readFileSync(path);
    const snapshot = readSnapshot({ path, now: () => "2026-10-14T00:00:00Z" });
    assert.deepEqual(readFileSync(path), before);
    assert.equal(snapshot.sessions.length, 4);
    assert.equal(snapshot.collectedAt, "2026-10-14T00:00:00Z");
    const root = snapshot.sessions.find((row) => row.id === "root");
    const child = snapshot.sessions.find((row) => row.id === "child");
    assert.equal(root.name, "Root app name");
    assert.equal(root.project, "Sample project");
    assert.equal(root.context.percent, 64);
    assert.equal(root.breakdown.system, 4000);
    assert.equal(root.breakdown.mcp, null);
    assert.equal(root.sampledAt, new Date(1791936000000).toISOString());
    assert.equal(child.parentId, "root");
    assert.equal(child.archived, true);
    assert.equal(snapshot.sessions.find((row) => row.id === "chat").parentId, "child");
    assert.equal(snapshot.sessions.find((row) => row.id === "pending-workspace").context.level, "unknown");
    assert.equal(snapshot.sessions.find((row) => row.id === "pending-workspace").running, null);
    assert.ok(!JSON.stringify(snapshot).includes("Historical identity"));
    assert.ok(!JSON.stringify(snapshot).includes("Deleted project session"));
});

test("optional metadata missing is explicit and does not invent token details", (t) => {
    const snapshot = readSnapshot({ path: fixture(t, { optional: false }) });
    assert.ok(snapshot.warnings.some((warning) => warning.includes("Chat parent links")));
    assert.equal(snapshot.sessions.find((row) => row.id === "root").sampledAt, null);
});

test("missing database never creates one; incompatible schemas fail explicitly", (t) => {
    const path = fixture(t);
    assert.throws(() => readSnapshot({ path: join(path, "absent") }), { code: "database_missing" });
    const db = new DatabaseSync(path);
    db.exec("ALTER TABLE sessions RENAME COLUMN context_current_tokens TO removed_context");
    db.close();
    assert.throws(() => readSnapshot({ path }), { code: "unsupported_schema" });
    assert.equal(databasePath({ COPILOT_HOME: "custom-home" }), join("custom-home", "data.db"));
});

test("historical alias parent and workspace parent identities both normalize", (t) => {
    const path = fixture(t);
    const db = new DatabaseSync(path);
    db.exec("UPDATE workspaces SET creator_session_id = 'root-workspace' WHERE session_id = 'child'");
    db.close();
    assert.equal(readSnapshot({ path }).sessions.find((row) => row.id === "child").parentId, "root");
});

test("loopback API requires a page token and rejects foreign origins, writes, and unknown assets", async (t) => {
    const server = await startServer(() => ({ sessions: [], warnings: [] }));
    t.after(server.close);
    const page = await fetch(server.url);
    assert.ok(page.headers.get("content-security-policy").includes("connect-src 'self'"));
    const html = await page.text();
    const token = html.match(/name="monitor-token" content="([a-f0-9]+)"/)[1];
    const url = new URL("api/snapshot", server.url);
    assert.equal((await fetch(url)).status, 403);
    assert.equal((await fetch(url, { headers: { "x-monitor-token": token, Origin: "https://example.com" } })).status, 403);
    assert.equal((await fetch(url, { headers: { "x-monitor-token": token, "sec-fetch-site": "cross-site" } })).status, 403);
    const response = await fetch(url, { headers: { "x-monitor-token": token } });
    assert.deepEqual(await response.json(), { sessions: [], warnings: [] });
    assert.equal((await fetch(url, { method: "POST" })).status, 405);
    assert.equal((await fetch(new URL("source.mjs", server.url))).status, 404);
    assert.equal((await fetch(new URL("model.mjs", server.url))).status, 200);
});

test("source errors become visible retryable HTTP errors, not empty success data", async (t) => {
    const server = await startServer(() => { throw Object.assign(new Error("Database not available"), { code: "database_missing" }); });
    t.after(server.close);
    const html = await (await fetch(server.url)).text();
    const token = html.match(/name="monitor-token" content="([a-f0-9]+)"/)[1];
    const response = await fetch(new URL("api/snapshot", server.url), { headers: { "x-monitor-token": token } });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Database not available", code: "database_missing" });
});
