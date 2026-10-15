import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextUsage, resolveParents, visibleTree, DEFAULT_THRESHOLDS, validateThresholds, SORT_PRESETS, isContextSort, tokenCount, availableModels, matchesFilters, buildUsageScale, usageColor, paginateSessions } from "./model.mjs";
import { databasePath, readSnapshot } from "./source.mjs";
import { startServer } from "./server.mjs";
import { createSettings } from "./settings.mjs";
import { runInNewContext } from "node:vm";

const palette = Object.freeze({
    low: "#d5eadc", soft: "#b1d6bc", sage: "#79ad91",
    warning: "#d8bc80", high: "#cf8f97", max: "#a9425b",
});

test("continuous usage colors share exact gradient stops and clamp only the visual scale", () => {
    const scale = buildUsageScale(DEFAULT_THRESHOLDS, palette);
    assert.equal(usageColor(0, scale), palette.low);
    assert.equal(usageColor(65, scale), palette.warning);
    assert.equal(usageColor(85, scale), palette.high);
    assert.equal(usageColor(100, scale), palette.max);
    assert.equal(usageColor(135, scale), palette.max);
    assert.equal(new Set(Array.from({ length: 101 }, (_, value) => usageColor(value, scale))).size, 101);
    assert.match(scale.gradient, /^linear-gradient\(90deg in srgb,/);
    for (const stop of scale.stops) {
        assert.equal(usageColor(stop.at, scale), stop.color);
        assert.ok(scale.gradient.includes(`${stop.color} ${stop.at}%`));
    }
    for (const value of [null, undefined, NaN, Infinity, -1]) assert.equal(usageColor(value, scale), null);
    const custom = buildUsageScale({ watch: 40, high: 70 }, palette);
    assert.equal(usageColor(40, custom), palette.warning);
    assert.equal(usageColor(70, custom), palette.high);
    assert.notEqual(usageColor(50, custom), usageColor(50, scale));
    for (const thresholds of [{ watch: 0, high: 1 }, { watch: 0, high: 100 }, { watch: 99, high: 100 }]) {
        const edge = buildUsageScale(thresholds, palette);
        assert.equal(usageColor(0, edge), palette.low);
        assert.equal(usageColor(100, edge), palette.max);
        assert.ok(edge.stops.every((stop, index) => index === 0 || stop.at > edge.stops[index - 1].at));
        assert.match(usageColor(50, edge), /^#[\da-f]{6}$/);
    }
    assert.throws(() => buildUsageScale(DEFAULT_THRESHOLDS, { ...palette, low: "invalid" }), /Invalid context color/);
    assert.throws(() => buildUsageScale({ watch: 85, high: 65 }, palette), { code: "invalid_input" });
});

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
        CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO app_state VALUES ('sidebar-project-groups',
            '{"state":{"pinnedWorkspaceIds":["root-workspace","chat"]},"version":0}');
        ALTER TABLE sessions ADD COLUMN total_input_tokens INTEGER;
        ALTER TABLE sessions ADD COLUMN total_output_tokens INTEGER;
        UPDATE sessions SET total_input_tokens = 1200000, total_output_tokens = 64000 WHERE id = 'root';
        UPDATE sessions SET total_input_tokens = 0, total_output_tokens = 0 WHERE id = 'chat';
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

test("canonical workspace parent links override stale creator identities", (t) => {
    const path = fixture(t);
    const db = new DatabaseSync(path);
    db.exec(`
        UPDATE workspaces SET creator_session_id = 'stale-creator' WHERE id = 'child-workspace';
        CREATE TABLE workspace_parent_links (child_workspace_id TEXT, parent_workspace_id TEXT);
        INSERT INTO workspace_parent_links VALUES ('child-workspace', 'root-workspace');
    `);
    db.close();
    const snapshot = readSnapshot({ path });
    assert.equal(snapshot.sessions.find((session) => session.id === "child").parentId, "root");
    assert.equal(snapshot.sessions.find((session) => session.id === "chat").parentId, "child");
});

test("color boundaries use actual utilization, not lifetime usage", () => {
    for (const [used, level] of [[0, "healthy"], [64999, "healthy"], [65000, "watch"], [84999, "watch"], [85000, "high"], [110000, "high"]]) {
        assert.equal(contextUsage(used, 100000).level, level);
    }
    assert.ok(Math.abs(contextUsage(110000, 100000).percent - 110) < 1e-9);
});

test("custom thresholds apply at exact boundaries and reject invalid percentages", () => {
    const thresholds = validateThresholds({ watch: 40, high: 70 });
    for (const [used, level] of [[39999, "healthy"], [40000, "watch"], [69999, "watch"], [70000, "high"]]) {
        assert.equal(contextUsage(used, 100000, thresholds).level, level);
    }
    assert.equal(contextUsage(null, 100000, thresholds).level, "unknown");
    assert.deepEqual(validateThresholds({ watch: 0, high: 100 }), { watch: 0, high: 100 });
    for (const value of [null, {}, { watch: 50, high: 50 }, { watch: 90, high: 60 },
        { watch: -1, high: 85 }, { watch: 65, high: 101 }, { watch: 65.5, high: 85 },
        { watch: "65", high: 85 }, { watch: NaN, high: 85 }]) {
        assert.throws(() => validateThresholds(value), { code: "invalid_input" });
    }
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
    assert.equal(result.find((row) => row.id === "a").descendantCount, 2);
    assert.equal(result.find((row) => row.id === "b").descendantCount, 1);
    assert.equal(visibleTree(tree, { collapsed: new Set(["a"]) }).find((row) => row.id === "a").descendantCount, 2);
    assert.equal(visibleTree(tree, { includeArchived: true }).find((row) => row.id === "d").descendantCount, 1);
});

test("search retains ancestors and reveals matches through collapsed parents", () => {
    const result = visibleTree(tree, { search: "model x", collapsed: new Set(["a"]) });
    assert.deepEqual(result.map((row) => row.id), ["a", "b", "c"]);
    assert.equal(result[0].matching, false);
    assert.equal(result[0].descendantCount, 2);
    assert.equal(visibleTree(tree, { search: "Root" })[0].descendantCount, 2);
    assert.equal(visibleTree(tree, { search: "no match" }).length, 0);
    assert.equal(visibleTree(tree, { includeArchived: true }).length, 5);
});

test("sort presets order groups and siblings by context, percentage, capacity, name, or activity", () => {
    const sessions = [
        { id: "parent", name: "Parent", updatedAt: "2026-10-10", context: contextUsage(10, 100) },
        { id: "low", name: "Low", parentId: "parent", updatedAt: "2026-10-13", context: contextUsage(5, 200) },
        { id: "max", name: "Max", parentId: "low", context: contextUsage(90, 100) },
        { id: "mid", name: "Mid", parentId: "parent", updatedAt: "2026-10-14", context: contextUsage(40, 100) },
        { id: "solo", name: "Solo", updatedAt: "2026-10-15", context: contextUsage(50, 1000) },
        { id: "zero", name: "Zero", updatedAt: "2026-10-11", context: contextUsage(0, 100) },
        { id: "unknown", name: "Unknown", context: contextUsage(null, null) },
        { id: "archived", name: "Archived", parentId: "parent", archived: true, context: contextUsage(999, 1000) },
    ];
    const ids = (sort, options) => visibleTree(sessions, { sort, ...options }).map((session) => session.id);
    assert.deepEqual(ids("context-high"), ["parent", "low", "max", "mid", "solo", "zero", "unknown"]);
    assert.deepEqual(ids("context-low"), ["zero", "parent", "low", "max", "mid", "solo", "unknown"]);
    assert.equal(ids("percent-high")[0], "parent");
    assert.equal(ids("percent-low")[0], "zero");
    assert.equal(ids("capacity")[0], "solo");
    assert.equal(ids("name-az")[0], "parent");
    assert.equal(ids("name-za")[0], "zero");
    assert.equal(ids("recent")[0], "solo");
    assert.equal(ids("context-high", { includeArchived: true })[1], "archived");
    assert.equal(ids("context-low").at(-1), "unknown");
    assert.equal(ids("context-high").at(-1), "unknown");
    assert.deepEqual(ids("context-high", { collapsed: new Set(["parent"]) }), ["parent", "solo", "zero", "unknown"]);
    const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
    for (const sort of Object.keys(SORT_PRESETS)) assert.ok(html.includes(`value="${sort}"`));
    assert.throws(() => visibleTree(sessions, { sort: "unsupported" }), /supported session sort/);
});

test("search sorts only matching contexts, not a hidden non-matching descendant", () => {
    const sessions = [
        { id: "parent", name: "Parent", context: contextUsage(10, 1000) },
        { id: "match", name: "Matching child", parentId: "parent", project: "matches", context: contextUsage(90, 1000) },
        { id: "outside", name: "Outside search", parentId: "parent", context: contextUsage(200, 1000) },
        { id: "solo", name: "Solo", project: "matches", context: contextUsage(95, 1000) },
    ];
    const result = visibleTree(sessions, { sort: "context-high", search: "matches" });
    assert.deepEqual(result.map((session) => session.id), ["solo", "parent", "match"]);
    assert.equal(result.find((session) => session.id === "parent").descendantCount, 2);
});

test("model options contain only models used by non-archived sessions", () => {
    assert.deepEqual(availableModels([
        { model: "gpt-6.1-sol" }, { model: "claude-sonnet-5.5" }, { model: "gpt-6.1-sol" },
        { model: "archived-model", archived: true }, { model: null }, { model: "" }, { model: "   " },
    ]), ["claude-sonnet-5.5", "gpt-6.1-sol"]);
});

test("pin and model filters intersect with search and retain only necessary ancestors", () => {
    const sessions = [
        { id: "root", name: "Root", model: "gpt-6.1-sol", pinned: false },
        { id: "child", name: "API review", parentId: "root", model: "claude-sonnet-5.5", pinned: true },
        { id: "grandchild", name: "Keyboard", parentId: "child", model: "gpt-5.4", pinned: false },
        { id: "other", name: "Other", parentId: "root", model: "claude-sonnet-5.5", pinned: false },
        { id: "unknown", name: "Unknown pins", pinned: null },
        { id: "archive", name: "Archived", model: "claude-sonnet-5.5", pinned: true, archived: true },
    ];
    const options = { onlyPinned: true, model: "claude-sonnet-5.5", collapsed: new Set(["root"]) };
    const result = visibleTree(sessions, options);
    assert.deepEqual(result.map((session) => session.id), ["root", "child"]);
    assert.equal(result[0].matching, false);
    assert.equal(result[1].matching, true);
    assert.deepEqual(visibleTree(sessions, { ...options, includeArchived: true }).filter((row) => row.matching).map((row) => row.id).sort(),
        ["archive", "child"]);
    assert.equal(visibleTree(sessions, { ...options, search: "Keyboard" }).length, 0);
    assert.equal(visibleTree(sessions, { model: "missing-model" }).length, 0);
    assert.equal(matchesFilters(sessions[1], { onlyPinned: true, model: "claude-sonnet-5.5", search: "api" }), true);
    assert.equal(matchesFilters(sessions[4], { onlyPinned: true }), false);
    assert.deepEqual(visibleTree(sessions, { model: "gpt-5.4" }).map((row) => row.id), ["root", "child", "grandchild"]);
});

test("usage filters select normal, warning, high, and unknown readings using configured levels", () => {
    const sessions = [
        { id: "normal", name: "Normal", pinned: true, model: "gpt-6.1-sol", context: contextUsage(64, 100) },
        { id: "warning", name: "Warning", parentId: "normal", pinned: true, model: "claude-sonnet-5.5", context: contextUsage(65, 100) },
        { id: "high", name: "High", parentId: "warning", pinned: false, model: "gpt-5.4", context: contextUsage(85, 100) },
        { id: "unknown", name: "Unknown", context: contextUsage(null, 100) },
        { id: "over", name: "Over", context: contextUsage(110, 100) },
    ];
    const matches = (level, options = {}, rows = sessions) =>
        visibleTree(rows, { usageLevel: level, ...options }).filter((row) => row.matching).map((row) => row.id).sort();
    assert.deepEqual(matches("healthy"), ["normal"]);
    assert.deepEqual(matches("watch"), ["warning"]);
    assert.deepEqual(matches("high"), ["high", "over"]);
    assert.deepEqual(matches("unknown"), ["unknown"]);
    assert.deepEqual(matches("watch", { onlyPinned: true, model: "claude-sonnet-5.5", search: "warn" }), ["warning"]);
    assert.deepEqual(matches("high", { onlyPinned: true }), []);
    const parents = visibleTree(sessions, { usageLevel: "high", collapsed: new Set(["normal", "warning"]) });
    assert.ok(parents.some((row) => row.id === "normal" && row.matching === false));
    assert.ok(parents.some((row) => row.id === "high" && row.matching === true));
    const custom = sessions.map((row) => ({ ...row, context: contextUsage(row.context.used, row.context.capacity, { watch: 40, high: 70 }) }));
    assert.deepEqual(matches("watch", {}, custom), ["normal", "warning"]);
    assert.deepEqual(matches("healthy", {}, custom), []);
    const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
    for (const label of ["Normal (green)", "Warning (yellow)", "High usage (red)", "No context data"]) assert.ok(html.includes(label));
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
    assert.deepEqual(root.usage, { input: 1200000, output: 64000 });
    assert.equal(root.pinned, true);
    assert.equal(snapshot.pinsAvailable, true);
    assert.equal(child.pinned, false);
    assert.equal(snapshot.sessions.find((row) => row.id === "chat").pinned, true);
    assert.deepEqual(snapshot.sessions.find((row) => row.id === "chat").usage, { input: 0, output: 0 });
    assert.deepEqual(snapshot.sessions.find((row) => row.id === "pending-workspace").usage, { input: null, output: null });
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
    assert.deepEqual(snapshot.sessions.find((row) => row.id === "root").usage, { input: null, output: null });
    assert.equal(snapshot.pinsAvailable, false);
    assert.equal(snapshot.sessions.find((row) => row.id === "root").pinned, null);
    assert.ok(snapshot.warnings.some((warning) => warning.includes("pinned-only filter is disabled")));
});

test("pins resolve historical identities and follow local app updates without pinning descendants", (t) => {
    const path = fixture(t);
    const db = new DatabaseSync(path);
    db.prepare("UPDATE app_state SET value = ? WHERE key = 'sidebar-project-groups'")
        .run(JSON.stringify({ state: { pinnedWorkspaceIds: ["old-root", "child-workspace"] }, version: 0 }));
    let snapshot = readSnapshot({ path });
    assert.equal(snapshot.sessions.find((row) => row.id === "root").pinned, true);
    assert.equal(snapshot.sessions.find((row) => row.id === "child").pinned, true);
    assert.equal(snapshot.sessions.find((row) => row.id === "chat").pinned, false);
    db.prepare("UPDATE app_state SET value = ? WHERE key = 'sidebar-project-groups'")
        .run(JSON.stringify({ state: { pinnedWorkspaceIds: [] }, version: 0 }));
    snapshot = readSnapshot({ path });
    assert.equal(snapshot.pinsAvailable, true);
    assert.ok(snapshot.sessions.every((row) => row.pinned === false));
    db.close();
});

test("malformed pin state is explicit instead of silently treating sessions as unpinned", (t) => {
    const path = fixture(t);
    const db = new DatabaseSync(path);
    for (const value of ["invalid-json", JSON.stringify({ state: {} }), JSON.stringify({ state: { pinnedWorkspaceIds: [123] } })]) {
        db.prepare("UPDATE app_state SET value = ? WHERE key = 'sidebar-project-groups'").run(value);
        const snapshot = readSnapshot({ path });
        assert.equal(snapshot.pinsAvailable, false);
        assert.ok(snapshot.sessions.every((row) => row.pinned === null));
        assert.ok(snapshot.warnings.some((warning) => warning.includes("pinned-only filter is disabled")));
    }
    db.exec("DELETE FROM app_state WHERE key = 'sidebar-project-groups'");
    assert.equal(readSnapshot({ path }).pinsAvailable, true);
    assert.ok(readSnapshot({ path }).sessions.every((row) => row.pinned === false));
    db.close();
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

test("configured thresholds classify the data adapter's snapshots too", (t) => {
    const snapshot = readSnapshot({ path: fixture(t), thresholds: { watch: 30, high: 60 } });
    assert.equal(snapshot.sessions.find((row) => row.id === "root").context.level, "high");
});

test("threshold preferences persist, reset to defaults, and reject stale concurrent writes", (t) => {
    const folder = mkdtempSync(join(tmpdir(), "context-monitor-settings-"));
    const stores = new Set();
    t.after(() => {
        for (const store of stores) store.close();
        rmSync(folder, { recursive: true, force: true });
    });
    const path = join(folder, "settings.sqlite");
    const first = createSettings(path);
    const second = createSettings(path);
    stores.add(first);
    stores.add(second);
    assert.deepEqual(first.read().thresholds, DEFAULT_THRESHOLDS);
    const saved = first.update({ watch: 40, high: 70, version: 1 });
    assert.deepEqual(second.read(), saved);
    assert.throws(() => second.update({ watch: 20, high: 50, version: 1 }), { code: "settings_changed" });
    for (const input of [{ watch: 70, high: 40, version: 2 }, { watch: 20, high: 70, version: 2, extra: true },
        { watch: 20, high: 70 }, { watch: 20, high: 70, version: 0 }]) {
        assert.throws(() => first.update(input), { code: "invalid_input" });
    }
    assert.deepEqual(first.read(), saved);
    first.close();
    stores.delete(first);
    const reopened = createSettings(path);
    stores.add(reopened);
    assert.deepEqual(reopened.read(), saved);
    reopened.update({ ...reopened.read().defaults, version: saved.version });
    assert.deepEqual(second.read().thresholds, DEFAULT_THRESHOLDS);
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
    for (const icon of ["caret-down.svg", "caret-up.svg"]) {
        const response = await fetch(new URL(`icons/${icon}`, server.url));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "image/svg+xml");
        assert.equal(await response.text(), readFileSync(new URL(`icons/${icon}`, import.meta.url), "utf8"));
    }
    for (const font of ["Geist-Variable.woff2", "GeistMono-Variable.woff2"]) {
        const response = await fetch(new URL(`fonts/${font}`, server.url));
        assert.equal(response.headers.get("content-type"), "font/woff2");
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(bytes.subarray(0, 4).toString("ascii"), "wOF2");
        assert.deepEqual(bytes, readFileSync(new URL(`fonts/${font}`, import.meta.url)));
    }
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

test("settings HTTP writes require the token, validate input, and report conflicts", async (t) => {
    const folder = mkdtempSync(join(tmpdir(), "context-monitor-http-settings-"));
    const settings = createSettings(join(folder, "settings.sqlite"));
    const server = await startServer(() => ({ sessions: [], settings: settings.read() }), settings);
    t.after(async () => {
        await server.close();
        settings.close();
        rmSync(folder, { recursive: true, force: true });
    });
    const html = await (await fetch(server.url)).text();
    const token = html.match(/name="monitor-token" content="([a-f0-9]+)"/)[1];
    const url = new URL("api/settings", server.url);
    const save = (input, headers = {}) => fetch(url, {
        method: "POST", headers: { "x-monitor-token": token, "content-type": "application/json", ...headers },
        body: typeof input === "string" ? input : JSON.stringify(input),
    });
    const input = { watch: 40, high: 70, version: 1 };
    assert.equal((await save(input, { "x-monitor-token": "" })).status, 403);
    assert.equal((await save(input, { Origin: "https://example.com" })).status, 403);
    assert.equal((await save(input, { "content-type": "text/plain" })).status, 403);
    assert.equal((await save("{")).status, 400);
    assert.equal((await save(" ".repeat(4097))).status, 400);
    assert.equal((await save({ ...input, high: 20 })).status, 400);
    const response = await save(input);
    assert.equal(response.status, 200);
    const current = await response.json();
    assert.deepEqual(current.thresholds, { watch: 40, high: 70 });
    const conflict = await save(input);
    assert.equal(conflict.status, 409);
    assert.deepEqual((await conflict.json()).settings, current);
});

function renderer({ sessions = [], pinsAvailable = true, includeMissing = false } = {}) {
    const node = (tag = "fragment") => ({
        tag, dataset: {}, style: { values: new Map(), setProperty(name, value) { this.values.set(name, value); } },
        children: [], attributes: new Map(),
        value: "", hidden: false, textContent: "", listeners: new Map(),
        setAttribute(name, value) { this.attributes.set(name, value); },
        append(...children) {
            for (const child of children) {
                if (child.tag === "fragment") this.append(...child.children);
                else { child.parent = this; this.children.push(child); }
            }
        },
        replaceChildren(...children) { this.children = []; this.append(...children); },
        addEventListener(name, callback) { this.listeners.set(name, callback); },
        scrollIntoView() { this.scrolled = true; },
    });
    const nodes = new Map();
    const document = {
        hidden: false, activeElement: null, listeners: new Map(),
        documentElement: node("html"), body: node("body"),
        querySelector: () => ({ content: "test-token" }),
        getElementById(id) {
            if (!nodes.has(id)) nodes.set(id, node());
            return nodes.get(id);
        },
        createDocumentFragment: node,
        createElement: node,
        addEventListener(name, callback) { this.listeners.set(name, callback); },
    };
    const timers = new Map();
    let clock = 0;
    let id = 0;
    let reads = 0;
    let pending;
    let hold = false;
    let writes = 0;
    let savedSettings = { thresholds: { ...DEFAULT_THRESHOLDS }, defaults: DEFAULT_THRESHOLDS, version: 1 };
    let currentPalette = palette;
    const themeCallbacks = [];
    document.getElementById("auto-refresh").value = "5000";
    document.getElementById("sort-by").value = "recent";
    document.getElementById("page-size").value = "8";
    document.getElementById("include-missing").checked = includeMissing;
    const code = readFileSync(new URL("./app.js", import.meta.url), "utf8").replace(/^import .*;\r?\n/, "");
    runInNewContext(code, {
        document, window: { addEventListener() {}, matchMedia: () => ({ addEventListener() {} }) },
        visibleTree, contextUsage, validateThresholds, DEFAULT_THRESHOLDS,
        SORT_PRESETS, isContextSort, tokenCount, Intl, Date,
        availableModels, matchesFilters, buildUsageScale, usageColor, paginateSessions,
        getComputedStyle: () => ({ getPropertyValue: (name) => currentPalette[name.replace("--usage-", "")] ?? "" }),
        MutationObserver: class { constructor(callback) { themeCallbacks.push(callback); } observe() {} },
        AbortSignal: { timeout: () => ({}) },
        setTimeout(callback, delay) { timers.set(++id, { callback, due: clock + delay }); return id; },
        clearTimeout(timerId) { timers.delete(timerId); },
        fetch(url, options) {
            if (url === "/api/settings") {
                writes++;
                const input = JSON.parse(options.body);
                if (input.version !== savedSettings.version) {
                    return Promise.resolve({
                        ok: false, json: async () => ({ error: "Usage warnings changed in another view.", settings: savedSettings }),
                    });
                }
                savedSettings = { thresholds: validateThresholds(input), defaults: DEFAULT_THRESHOLDS, version: input.version + 1 };
                return Promise.resolve({ ok: true, json: async () => savedSettings });
            }
            reads++;
            const data = {
                sessions: [...sessions], warnings: [], collectedAt: "2026-10-14T00:00:00Z", pinsAvailable,
                settings: savedSettings,
            };
            const response = { ok: true, json: async () => data };
            return hold ? new Promise((resolve) => { pending = () => resolve(response); }) : Promise.resolve(response);
        },
    });
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    const elements = () => {
        const result = [];
        const stack = [...document.getElementById("sessions").children].reverse();
        while (stack.length) {
            const element = stack.pop();
            result.push(element);
            stack.push(...[...element.children].reverse());
        }
        return result;
    };
    return {
        document, timers, nodes, settle, elements,
        heatCells: () => document.getElementById("heatmap").children,
        theme(next) {
            currentPalette = next;
            for (const callback of themeCallbacks) callback();
        },
        includeArchived(checked) {
            const control = document.getElementById("archived");
            control.checked = checked;
            control.listeners.get("change")();
        },
        hideMissing(checked) {
            const control = document.getElementById("include-missing");
            control.checked = !checked;
            control.listeners.get("change")();
        },
        pageSize(value) {
            const control = document.getElementById("page-size");
            control.value = String(value);
            control.listeners.get("change")();
        },
        nextPage: () => document.getElementById("page-next").listeners.get("click")(),
        previousPage: () => document.getElementById("page-previous").listeners.get("click")(),
        fold(id) {
            const button = elements().find((element) => element.dataset.action === "fold" && element.dataset.id === id);
            document.getElementById("sessions").listeners.get("click")({ target: { closest: () => button } });
        },
        details(id) {
            const button = elements().find((element) => element.dataset.action === "details" && element.dataset.id === id);
            document.getElementById("sessions").listeners.get("click")({ target: { closest: () => button } });
        },
        search(value) {
            const control = document.getElementById("search");
            control.value = value;
            control.listeners.get("input")();
        },
        sort(value) {
            const control = document.getElementById("sort-by");
            control.value = value;
            control.listeners.get("change")();
        },
        filterModel(value) {
            const control = document.getElementById("model-filter");
            control.value = value;
            control.listeners.get("change")();
        },
        usageLevel(value) {
            const control = document.getElementById("usage-filter");
            control.value = value;
            control.listeners.get("change")();
        },
        onlyPinned(checked) {
            const control = document.getElementById("pinned-only");
            control.checked = checked;
            control.listeners.get("change")();
        },
        reads: () => reads,
        writes: () => writes,
        saved: () => savedSettings,
        draft(watch, high) {
            for (const [id, value] of [["amber-threshold", watch], ["rose-threshold", high]]) {
                const input = document.getElementById(id);
                input.value = String(value);
                input.listeners.get("input")();
            }
        },
        submit: () => document.getElementById("threshold-form").listeners.get("submit")({ preventDefault() {} }),
        reset: () => document.getElementById("reset-thresholds").listeners.get("click")(),
        remoteChange(watch, high) {
            savedSettings = { thresholds: { watch, high }, defaults: DEFAULT_THRESHOLDS, version: savedSettings.version + 1 };
        },
        change(value) {
            const control = document.getElementById("auto-refresh");
            control.value = String(value);
            control.listeners.get("change")();
        },
        async advance(duration) {
            clock += duration;
            for (const [timerId, timer] of [...timers]) {
                if (timer.due <= clock) {
                    timers.delete(timerId);
                    timer.callback();
                }
            }
            await settle();
        },
        visibility(hidden) {
            document.hidden = hidden;
            document.listeners.get("visibilitychange")();
        },
        manual: () => document.getElementById("refresh").listeners.get("click")(),
        hold: () => { hold = true; },
        release: () => { hold = false; pending(); },
    };
}

test("auto-refresh defaults to 5s and fires at each selected interval, not earlier", async () => {
    const ui = renderer();
    await ui.settle();
    assert.equal(ui.reads(), 1);
    assert.equal(ui.timers.size, 1);
    const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
    assert.match(html, /value="5000" selected/);
    for (const interval of [5000, 10000, 30000, 60000, 300000]) {
        assert.ok(html.includes(`value="${interval}"`));
        ui.change(interval);
        const before = ui.reads();
        assert.equal(ui.timers.size, 1);
        await ui.advance(interval - 1);
        assert.equal(ui.reads(), before);
        await ui.advance(1);
        assert.equal(ui.reads(), before + 1);
        assert.equal(ui.timers.size, 1);
    }
});

test("Off cancels automatic reads but manual refresh still works, including after hiding", async () => {
    const ui = renderer();
    await ui.settle();
    ui.change(0);
    assert.equal(ui.timers.size, 0);
    assert.equal(ui.nodes.get("refresh-status").textContent, "Read-only / auto-refresh off");
    await ui.advance(300000);
    ui.visibility(true);
    ui.visibility(false);
    await ui.settle();
    assert.equal(ui.reads(), 1);
    await ui.manual();
    assert.equal(ui.reads(), 2);
    assert.equal(ui.timers.size, 0);
    ui.change(30000);
    ui.visibility(true);
    await ui.advance(30000);
    assert.equal(ui.reads(), 2);
    ui.visibility(false);
    await ui.settle();
    assert.equal(ui.reads(), 3);
    assert.equal(ui.timers.size, 1);
});

test("changing intervals during a read schedules only the latest interval after it finishes", async () => {
    const ui = renderer();
    await ui.settle();
    ui.hold();
    const request = ui.manual();
    ui.change(10000);
    ui.change(60000);
    assert.equal(ui.timers.size, 0);
    ui.manual();
    assert.equal(ui.reads(), 2);
    ui.release();
    await request;
    await ui.advance(59999);
    assert.equal(ui.reads(), 2);
    await ui.advance(1);
    assert.equal(ui.reads(), 3);
    ui.hold();
    const last = ui.manual();
    ui.change(0);
    ui.release();
    await last;
    assert.equal(ui.timers.size, 0);
});

test("threshold controls apply, reject invalid drafts, and reset both inputs and saved values", async () => {
    const ui = renderer();
    await ui.settle();
    ui.draft(40, 70);
    ui.submit();
    await ui.settle();
    assert.deepEqual(ui.saved().thresholds, { watch: 40, high: 70 });
    assert.equal(ui.nodes.get("legend-high").textContent, "High usage 70%+");
    ui.draft(90, 50);
    ui.submit();
    await ui.settle();
    assert.equal(ui.writes(), 1);
    assert.match(ui.nodes.get("threshold-status").textContent, /warning level must be lower/);
    assert.equal(ui.nodes.get("legend-high").textContent, "High usage 70%+");
    await ui.reset();
    assert.deepEqual(ui.saved().thresholds, DEFAULT_THRESHOLDS);
    assert.equal(ui.nodes.get("amber-threshold").value, "65");
    assert.equal(ui.nodes.get("rose-threshold").value, "85");
    assert.equal(ui.nodes.get("legend-high").textContent, "High usage 85%+");
});

test("polling and conflicts preserve threshold drafts; stale snapshots never revert newly saved colors", async () => {
    const ui = renderer();
    await ui.settle();
    ui.draft(40, 70);
    ui.remoteChange(50, 80);
    await ui.manual();
    assert.equal(ui.nodes.get("amber-threshold").value, "40");
    assert.equal(ui.nodes.get("legend-high").textContent, "High usage 80%+");
    ui.submit();
    await ui.settle();
    assert.match(ui.nodes.get("threshold-status").textContent, /another view/);
    assert.equal(ui.nodes.get("amber-threshold").value, "40");
    ui.submit();
    await ui.settle();
    assert.deepEqual(ui.saved().thresholds, { watch: 40, high: 70 });
    ui.hold();
    const staleRead = ui.manual();
    ui.draft(50, 90);
    ui.submit();
    await ui.settle();
    assert.equal(ui.nodes.get("legend-high").textContent, "High usage 90%+");
    ui.release();
    await staleRead;
    assert.equal(ui.nodes.get("legend-high").textContent, "High usage 90%+");
    assert.equal(ui.nodes.get("rose-threshold").value, "90");
});

test("parent disclosure expands one level at a time, survives refresh, and search preserves collapse choices", async () => {
    const ui = renderer({ sessions: tree.map((session) => ({ ...session, context: { used: 10, capacity: 100 } })) });
    await ui.settle();
    const articles = () => ui.elements().filter((element) => element.tag === "article");
    const button = (id) => ui.elements().find((element) => element.dataset.action === "fold" && element.dataset.id === id);
    assert.equal(articles().length, 2);
    assert.equal(button("a").attributes.get("aria-label"), "Show nested sessions for Root");
    assert.equal(button("a").textContent, "");
    assert.equal(button("a").children[0].className, "disclosure-icon show-children");
    assert.equal(button("a").parent.className, "identity");
    assert.equal(button("a").parent.children[0], button("a"));
    assert.equal(button("a").attributes.get("aria-expanded"), "false");
    assert.ok(ui.elements().some((element) => element.textContent === "Parent session / 2 nested"));
    ui.fold("a");
    assert.equal(articles().length, 3);
    assert.equal(button("b").attributes.get("aria-label"), "Show nested sessions for Child");
    ui.fold("b");
    assert.equal(articles().length, 4);
    assert.equal(button("a").attributes.get("aria-label"), "Hide nested sessions for Root");
    assert.equal(button("b").attributes.get("aria-label"), "Hide nested sessions for Child");
    assert.equal(button("a").children[0].className, "disclosure-icon hide-children");
    assert.equal(button("a").dataset.tooltip, "Hide nested sessions (2)");
    const children = ui.elements().find((element) => element.id === "children-a");
    assert.equal(children.attributes.get("role"), "group");
    assert.ok(children.children.every((element) => element.tag === "article"));
    assert.ok(ui.elements().some((element) => element.textContent === "Nested session / Level 2"));
    ui.fold("b");
    assert.equal(articles().length, 3);
    await ui.manual();
    assert.equal(articles().length, 3);
    ui.fold("a");
    assert.equal(articles().length, 2);
    ui.search("Grandchild");
    assert.equal(articles().length, 3);
    assert.equal(button("a").disabled, true);
    ui.search("");
    assert.equal(articles().length, 2);
    ui.fold("a");
    assert.equal(articles().length, 3);
    assert.equal(button("b").attributes.get("aria-label"), "Show nested sessions for Child");
});

test("context bars and heat tiles share one continuous scale; unknown stays neutral", async () => {
    const ui = renderer({ includeMissing: true, sessions: [
        { id: "measured", name: "Measured", context: { used: 234, capacity: 1000 } },
        { id: "overflow", name: "Overflow", context: { used: 1100, capacity: 1000 } },
        { id: "unknown", name: "Unknown", context: { used: null, capacity: 1000 } },
    ] });
    await ui.settle();
    const lines = () => ui.elements().filter((element) => element.className === "line");
    const atMeasuredUsage = (line) => Math.abs(Number.parseFloat(line.style.values.get("--usage")) - 23.4) < 1e-9;
    const known = lines().find(atMeasuredUsage);
    const originalScale = buildUsageScale(DEFAULT_THRESHOLDS, palette);
    assert.equal(known.style.values.get("--usage-gradient"), originalScale.gradient);
    assert.equal(ui.nodes.get("heatmap-scale").style.values.get("--usage-gradient"), originalScale.gradient);
    assert.equal(ui.heatCells().find((tile) => tile.dataset.id === "measured").style.values.get("--heat-color"),
        usageColor(23.4, originalScale));
    assert.deepEqual(known.children.map((child) => child.className), ["marker"]);
    assert.ok(lines().some((line) => line.style.values.get("--usage") === "100%"));
    const unknown = lines().find((line) => line.parent.className === "context unknown");
    assert.equal(unknown.children.length, 0);
    assert.equal(unknown.style.values.has("--usage"), false);
    ui.draft(40, 70);
    ui.submit();
    await ui.settle();
    const updated = lines().find(atMeasuredUsage);
    const customScale = buildUsageScale({ watch: 40, high: 70 }, palette);
    assert.equal(updated.style.values.get("--usage-gradient"), customScale.gradient);
    assert.equal(ui.heatCells().find((tile) => tile.dataset.id === "measured").style.values.get("--heat-color"),
        usageColor(23.4, customScale));
});

test("context sorting reveals nested sessions and preserves ordering across refresh", async () => {
    const ui = renderer({ sessions: [
        { id: "parent", name: "Parent", context: { used: 10, capacity: 100 } },
        { id: "child", name: "Child", parentId: "parent", context: { used: 90, capacity: 100 } },
        { id: "solo", name: "Solo", context: { used: 50, capacity: 100 } },
    ] });
    await ui.settle();
    const ids = () => ui.elements().filter((node) => node.dataset.action === "details").map((node) => node.dataset.id);
    assert.deepEqual(ids(), ["parent", "solo"]);
    ui.sort("context-high");
    assert.deepEqual(ids(), ["parent", "child", "solo"]);
    assert.match(ui.nodes.get("sort-help").textContent, /largest context/);
    await ui.manual();
    assert.deepEqual(ids(), ["parent", "child", "solo"]);
    ui.sort("context-low");
    assert.deepEqual(ids(), ["parent", "child", "solo"]);
    ui.sort("name-za");
    assert.deepEqual(ids(), ["solo", "parent", "child"]);
    assert.match(ui.nodes.get("legend-watch").textContent, /Warning/);
});

test("compact rows explain cumulative input/output totals separately from current context", async () => {
    const ui = renderer({ includeMissing: true, sessions: [
        {
            id: "reported", name: "Reported", model: "claude-sonnet-5.5", updatedAt: "2026-10-15",
            context: { used: 40000, capacity: 100000 },
            usage: { input: 1200000, output: 64000 },
            breakdown: { outputLimit: 16000, system: 2000, conversation: 30000, tools: 8000, mcp: null, buffer: null },
        },
        { id: "zero", name: "Zero", updatedAt: "2026-10-14", context: { used: 0, capacity: 100000 }, usage: { input: 0, output: 0 } },
        { id: "missing", name: "Missing", updatedAt: "2026-10-13", context: { used: null, capacity: 100000 } },
    ] });
    await ui.settle();
    const totals = ui.elements().filter((node) => node.className === "token-totals");
    assert.deepEqual(totals[0].children.map((pair) => pair.children.map((node) => node.textContent)),
        [["Input total", "1.2M"], ["Output total", "64K"]]);
    assert.deepEqual(totals[1].children.map((pair) => pair.children[1].textContent), ["0", "0"]);
    assert.deepEqual(totals[2].children.map((pair) => pair.children[1].textContent), ["Not reported", "Not reported"]);
    assert.ok(totals[0].children[0].title.includes("not the current context"));
    const counts = ui.elements().filter((node) => node.className === "context-count");
    assert.equal(counts[0].children[0].textContent, "Context: ");
    assert.equal(counts[0].children[1].textContent, "40K of 100K tokens");
    assert.equal(counts[2].children[1].textContent, "No reading; 100K capacity");
    const usageLabels = ui.elements().filter((node) => node.className === "percent");
    assert.deepEqual(usageLabels.map((node) => node.textContent), ["40.0% used", "0.0% used", "N/A"]);
    assert.equal(ui.elements().some((node) => node.className === "used-label"), false);
    assert.ok(ui.elements().some((node) => node.className === "missing-usage" && node.textContent === "No context data"));
    ui.details("reported");
    for (const text of ["Input total", "Output total", "Input window limit", "Reply output limit",
        "Tokens read across requests in this session.", "Maximum tokens the model can generate in one response."]) {
        assert.ok(ui.elements().some((node) => node.textContent === text), `Missing ${text}`);
    }
    const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
    assert.ok(html.includes("Include archived sessions"));
    assert.ok(html.includes("Input/output totals add up across requests"));
    assert.ok(html.includes("what it generates"));
});

test("renderer filters pins and models while distinguishing parent context from matches", async () => {
    const sessions = [
        { id: "root", name: "Root", model: "gpt-6.1-sol", pinned: false, context: { used: 99, capacity: 100 } },
        { id: "child", name: "Child", parentId: "root", model: "claude-sonnet-5.5", pinned: true, context: { used: 10, capacity: 100 } },
        { id: "other", name: "Other", model: "gpt-6.1-sol", pinned: true, context: { used: 50, capacity: 100 } },
    ];
    const ui = renderer({ sessions });
    await ui.settle();
    const ids = () => ui.elements().filter((node) => node.dataset.action === "details").map((node) => node.dataset.id);
    assert.deepEqual(ui.nodes.get("model-filter").children.map((node) => node.value), ["", "claude-sonnet-5.5", "gpt-6.1-sol"]);
    ui.onlyPinned(true);
    ui.filterModel("claude-sonnet-5.5");
    assert.deepEqual(ids(), ["root", "child"]);
    assert.equal(ui.nodes.get("count").textContent, "1 parent shown for context");
    assert.ok(ui.elements().some((node) => node.textContent === "Parent of matching sessions"));
    assert.ok(ui.elements().some((node) => node.textContent === "Nested session / Pinned"));
    const existingOption = ui.nodes.get("model-filter").children[1];
    await ui.manual();
    assert.equal(ui.nodes.get("model-filter").value, "claude-sonnet-5.5");
    assert.equal(ui.nodes.get("model-filter").children[1], existingOption);
    ui.search("not found");
    assert.ok(ui.elements().some((node) => node.textContent === "No matching sessions"));
    ui.search("");
    ui.filterModel("");
    ui.onlyPinned(false);
    assert.deepEqual(ids(), ["other", "root"]);
});

test("model options update on refresh and explicitly reset a selection that disappears", async () => {
    const sessions = [{ id: "one", name: "One", model: "gpt-6.1-sol", context: { used: 10, capacity: 100 } }];
    const ui = renderer({ sessions });
    await ui.settle();
    ui.filterModel("gpt-6.1-sol");
    sessions[0] = { ...sessions[0], model: "claude-sonnet-5.5" };
    await ui.manual();
    assert.deepEqual(ui.nodes.get("model-filter").children.map((node) => node.value), ["", "claude-sonnet-5.5"]);
    assert.equal(ui.nodes.get("model-filter").value, "");
    assert.equal(ui.nodes.get("filter-status").hidden, false);
    assert.match(ui.nodes.get("filter-status").textContent, /gpt-6.1-sol is no longer used/);
    const unavailable = renderer({ sessions, pinsAvailable: false });
    await unavailable.settle();
    assert.equal(unavailable.nodes.get("pinned-only").disabled, true);
});

test("usage filtering updates immediately after threshold changes and survives refresh", async () => {
    const ui = renderer({ sessions: [
        { id: "low", name: "Low", pinned: true, model: "gpt-6.1-sol", context: { used: 50, capacity: 100 } },
        { id: "warn", name: "Warning", pinned: true, model: "claude-sonnet-5.5", context: { used: 70, capacity: 100 } },
        { id: "high", name: "High", pinned: false, context: { used: 90, capacity: 100 } },
    ] });
    await ui.settle();
    const ids = () => ui.elements().filter((node) => node.dataset.action === "details").map((node) => node.dataset.id).sort();
    ui.usageLevel("watch");
    assert.deepEqual(ids(), ["warn"]);
    await ui.manual();
    assert.equal(ui.nodes.get("usage-filter").value, "watch");
    assert.deepEqual(ids(), ["warn"]);
    ui.draft(40, 60);
    ui.submit();
    await ui.settle();
    assert.deepEqual(ids(), ["low"]);
    ui.usageLevel("high");
    assert.deepEqual(ids(), ["high", "warn"]);
    ui.onlyPinned(true);
    assert.deepEqual(ids(), ["warn"]);
    ui.filterModel("gpt-6.1-sol");
    assert.deepEqual(ids(), []);
    assert.ok(ui.elements().some((node) => node.textContent === "No matching sessions"));
    ui.usageLevel("");
    assert.deepEqual(ids(), ["low"]);
    await ui.reset();
    assert.equal(ui.nodes.get("usage-filter").value, "");
});

test("heat map includes collapsed descendants, excludes context-only parents, and follows every filter and sort", async () => {
    const sessions = [
        { id: "root", name: "Root", model: "gpt-6.1-sol", pinned: false, context: { used: 20, capacity: 100 } },
        { id: "child", name: "Child", parentId: "root", model: "claude-sonnet-5.5", pinned: true, context: { used: 70, capacity: 100 } },
        { id: "high", name: "High", model: "gpt-6.1-sol", pinned: true, context: { used: 95, capacity: 100 } },
        { id: "unknown", name: "Unknown", model: null, pinned: false, context: { used: null, capacity: 100 } },
        { id: "archived", name: "Archived", model: "gpt-6.1-sol", pinned: true, archived: true, context: { used: 10, capacity: 100 } },
    ];
    const ui = renderer({ sessions, includeMissing: true });
    await ui.settle();
    const ids = () => ui.heatCells().map((tile) => tile.dataset.id);
    assert.equal(ui.elements().filter((node) => node.tag === "article").length, 3);
    assert.equal(ids().length, 4);
    assert.ok(ids().includes("child"));
    assert.equal(ui.heatCells().filter((tile) => tile.tabIndex === 0).length, 1);
    const missing = ui.heatCells().find((tile) => tile.dataset.id === "unknown");
    assert.equal(missing.style.values.has("--heat-color"), false);
    assert.equal(missing.className, "heat-cell unknown");
    assert.match(missing.title, /No context data/);
    ui.fold("root");
    assert.equal(ids().length, 4);
    ui.onlyPinned(true);
    ui.filterModel("claude-sonnet-5.5");
    ui.usageLevel("watch");
    assert.deepEqual(ids(), ["child"]);
    assert.equal(ui.nodes.get("heatmap-count").textContent, "(1)");
    assert.ok(ui.elements().some((node) => node.textContent === "Parent of matching sessions"));
    ui.search("no match");
    assert.equal(ui.nodes.get("heatmap-region").hidden, true);
    assert.equal(ids().length, 0);
    ui.search("");
    ui.onlyPinned(false);
    ui.filterModel("");
    ui.usageLevel("");
    ui.includeArchived(true);
    assert.equal(ids().length, 5);
    ui.sort("name-az");
    assert.deepEqual(ids(), ["archived", "high", "root", "child", "unknown"]);
    await ui.manual();
    assert.deepEqual(ids(), ["archived", "high", "root", "child", "unknown"]);
    const before = ui.heatCells().find((tile) => tile.dataset.id === "child").style.values.get("--heat-color");
    const nextPalette = { ...palette, low: "#cbe8d6", warning: "#d6b77d", max: "#b34e68" };
    ui.theme(nextPalette);
    const after = ui.heatCells().find((tile) => tile.dataset.id === "child").style.values.get("--heat-color");
    assert.notEqual(after, before);
    assert.equal(after, usageColor(70, buildUsageScale(DEFAULT_THRESHOLDS, nextPalette)));
    sessions[1] = { ...sessions[1], context: { used: 88, capacity: 100 } };
    await ui.advance(5000);
    assert.match(ui.heatCells().find((tile) => tile.dataset.id === "child").title, /88.0% used/);
});

test("page controls bound only the list while the heat map covers every filtered session", async () => {
    const sessions = Array.from({ length: 25 }, (_, index) => ({
        id: `session-${index}`, name: `Session ${String(index).padStart(2, "0")}`, context: { used: index, capacity: 100 },
    }));
    const ui = renderer({ sessions });
    await ui.settle();
    assert.equal(ui.heatCells().length, 25);
    assert.equal(ui.nodes.get("heatmap-count").textContent, "(25)");
    assert.equal(ui.nodes.get("page-status").textContent, "Page 1 of 4");
    assert.equal(ui.nodes.get("page-range").textContent, "1-8 of 25 sessions");
    assert.equal(ui.elements().filter((node) => node.tag === "article").length, 8);
    assert.equal(ui.nodes.get("page-previous").disabled, true);
    ui.nextPage();
    assert.equal(ui.heatCells()[0].dataset.id, "session-0");
    assert.equal(ui.heatCells().length, 25);
    await ui.manual();
    assert.equal(ui.nodes.get("page-status").textContent, "Page 2 of 4");
    ui.nextPage();
    ui.nextPage();
    assert.equal(ui.heatCells().length, 25);
    assert.equal(ui.nodes.get("heatmap-count").textContent, "(25)");
    assert.equal(ui.elements().filter((node) => node.tag === "article").length, 1);
    assert.equal(ui.nodes.get("page-next").disabled, true);
    ui.previousPage();
    assert.equal(ui.nodes.get("page-status").textContent, "Page 3 of 4");
    ui.pageSize(16);
    assert.equal(ui.nodes.get("page-status").textContent, "Page 1 of 2");
    assert.equal(ui.heatCells().length, 25);
    ui.search("Session 24");
    assert.equal(ui.heatCells().length, 1);
    assert.equal(ui.nodes.get("page-status").textContent, "Page 1 of 1");
});

test("pagination clamps shrinking results and validates pages and supported sizes", () => {
    const sessions = Array.from({ length: 35 }, (_, id) => ({ id }));
    assert.deepEqual(paginateSessions(sessions).sessions, sessions.slice(0, 8));
    assert.equal(paginateSessions(sessions, 99).page, 5);
    assert.equal(paginateSessions(sessions, 5).sessions.length, 3);
    assert.equal(paginateSessions(sessions.slice(0, 3), 5).page, 1);
    assert.deepEqual(paginateSessions([], 5), {
        page: 1, pages: 1, pageSize: 8, sessions: [], start: 0, end: 0, matching: 0,
    });
    for (const size of [8, 16, 32]) assert.equal(paginateSessions(sessions, 1, size).sessions.length, size);
    for (const size of [0, 10, 64, "8"]) assert.throws(() => paginateSessions(sessions, 1, size), { code: "invalid_input" });
    for (const page of [0, -1, 1.5, NaN]) assert.throws(() => paginateSessions(sessions, page), { code: "invalid_input" });
});

test("later pages retain parent context without duplicating global heat-map tiles", async () => {
    const sessions = [
        { id: "root", name: "Root", context: { used: 10, capacity: 100 } },
        ...Array.from({ length: 18 }, (_, index) => ({
            id: `child-${index}`, name: `Child ${String(index).padStart(2, "0")}`,
            parentId: "root", context: { used: index, capacity: 100 },
        })),
    ];
    const ui = renderer({ sessions });
    await ui.settle();
    assert.equal(ui.heatCells().length, 19);
    assert.equal(ui.elements().filter((node) => node.tag === "article").length, 1);
    ui.nextPage();
    assert.equal(ui.heatCells().length, 19);
    assert.equal(ui.heatCells().filter((tile) => tile.dataset.id === "root").length, 1);
    assert.equal(ui.elements().filter((node) => node.tag === "article").length, 9);
    assert.ok(ui.elements().some((node) => node.textContent === "Parent of sessions on this page"));
    const parent = ui.elements().find((node) => node.dataset.action === "fold" && node.dataset.id === "root");
    assert.equal(parent.disabled, true);
    assert.equal(parent.attributes.get("aria-expanded"), "true");
    ui.nextPage();
    assert.equal(ui.heatCells().length, 19);
    assert.equal(ui.nodes.get("heatmap-count").textContent, "(19)");
    sessions.splice(4);
    await ui.manual();
    assert.equal(ui.nodes.get("page-status").textContent, "Page 1 of 1");
    assert.equal(ui.heatCells().length, 4);
});

test("missing context is hidden by default and can be included without hiding actual zero usage", async () => {
    const sessions = [
        { id: "zero", name: "Zero", context: { used: 0, capacity: 100 }, pinned: true, model: "gpt-6.1-sol" },
        { id: "known", name: "Known", context: { used: 70, capacity: 100 }, pinned: true, model: "gpt-6.1-sol" },
        { id: "missing", name: "Missing", context: { used: null, capacity: 100 }, pinned: true, model: "gpt-6.1-sol" },
    ];
    const ui = renderer({ sessions });
    await ui.settle();
    assert.equal(ui.nodes.get("include-missing").checked, false);
    assert.deepEqual(ui.heatCells().map((tile) => tile.dataset.id), ["known", "zero"]);
    ui.hideMissing(false);
    assert.equal(ui.heatCells().length, 3);
    ui.hideMissing(true);
    assert.deepEqual(ui.heatCells().map((tile) => tile.dataset.id), ["known", "zero"]);
    assert.equal(ui.nodes.get("heatmap-count").textContent, "(2)");
    assert.equal(ui.nodes.get("heatmap-missing-key").hidden, true);
    await ui.manual();
    assert.equal(ui.heatCells().length, 2);
    ui.usageLevel("unknown");
    assert.equal(ui.nodes.get("include-missing").checked, true);
    assert.deepEqual(ui.heatCells().map((tile) => tile.dataset.id), ["missing"]);
    assert.equal(ui.nodes.get("heatmap-missing-key").hidden, false);
    ui.hideMissing(true);
    assert.equal(ui.nodes.get("usage-filter").value, "");
    assert.deepEqual(ui.heatCells().map((tile) => tile.dataset.id), ["known", "zero"]);
});

test("partial groups retain the global sort order on later pages", () => {
    const sessions = [
        { id: "a", name: "A", context: contextUsage(20, 100) },
        { id: "max", name: "Max", parentId: "a", context: contextUsage(100, 100) },
        ...Array.from({ length: 8 }, (_, index) => ({
            id: `low-${index}`, name: `Low ${index}`, parentId: "a", context: contextUsage(index + 1, 100),
        })),
        { id: "b", name: "B", context: contextUsage(90, 100) },
        { id: "b-child", name: "B child", parentId: "b", context: contextUsage(30, 100) },
    ];
    const ordered = visibleTree(sessions, { sort: "context-high" });
    const page = paginateSessions(ordered, 2);
    const selected = new Set(page.sessions.map((session) => session.id));
    const visible = visibleTree(sessions, { sort: "context-high", sessionIds: selected });
    assert.deepEqual(visible.filter((session) => session.matching).map((session) => session.id),
        page.sessions.map((session) => session.id));
});
