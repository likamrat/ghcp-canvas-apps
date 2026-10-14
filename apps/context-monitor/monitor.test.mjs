import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextUsage, resolveParents, visibleTree, DEFAULT_THRESHOLDS, validateThresholds } from "./model.mjs";
import { databasePath, readSnapshot } from "./source.mjs";
import { startServer } from "./server.mjs";
import { createSettings } from "./settings.mjs";
import { runInNewContext } from "node:vm";

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

function renderer({ sessions = [] } = {}) {
    const node = (tag = "fragment") => ({
        tag, dataset: {}, style: { setProperty() {} }, children: [], attributes: new Map(),
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
    });
    const nodes = new Map();
    const document = {
        hidden: false, activeElement: null, listeners: new Map(),
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
    document.getElementById("auto-refresh").value = "5000";
    const code = readFileSync(new URL("./app.js", import.meta.url), "utf8").replace(/^import .*;\r?\n/, "");
    runInNewContext(code, {
        document, window: { addEventListener() {} }, visibleTree, contextUsage, validateThresholds, DEFAULT_THRESHOLDS, Intl, Date,
        AbortSignal: { timeout: () => ({}) },
        setTimeout(callback, delay) { timers.set(++id, { callback, due: clock + delay }); return id; },
        clearTimeout(timerId) { timers.delete(timerId); },
        fetch(url, options) {
            if (url === "/api/settings") {
                writes++;
                const input = JSON.parse(options.body);
                if (input.version !== savedSettings.version) {
                    return Promise.resolve({
                        ok: false, json: async () => ({ error: "Thresholds changed in another view.", settings: savedSettings }),
                    });
                }
                savedSettings = { thresholds: validateThresholds(input), defaults: DEFAULT_THRESHOLDS, version: input.version + 1 };
                return Promise.resolve({ ok: true, json: async () => savedSettings });
            }
            reads++;
            const data = {
                sessions, warnings: [], collectedAt: "2026-10-14T00:00:00Z",
                settings: savedSettings,
            };
            const response = { ok: true, json: async () => data };
            return hold ? new Promise((resolve) => { pending = () => resolve(response); }) : Promise.resolve(response);
        },
    });
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    const elements = () => {
        const result = [];
        const stack = [...document.getElementById("sessions").children];
        while (stack.length) {
            const element = stack.pop();
            result.push(element);
            stack.push(...element.children);
        }
        return result;
    };
    return {
        document, timers, nodes, settle, elements,
        fold(id) {
            const button = elements().find((element) => element.dataset.action === "fold" && element.dataset.id === id);
            document.getElementById("sessions").listeners.get("click")({ target: { closest: () => button } });
        },
        search(value) {
            const control = document.getElementById("search");
            control.value = value;
            control.listeners.get("input")();
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
    assert.equal(ui.nodes.get("legend-high").textContent, "70%+");
    ui.draft(90, 50);
    ui.submit();
    await ui.settle();
    assert.equal(ui.writes(), 1);
    assert.match(ui.nodes.get("threshold-status").textContent, /amber lower than rose/);
    assert.equal(ui.nodes.get("legend-high").textContent, "70%+");
    await ui.reset();
    assert.deepEqual(ui.saved().thresholds, DEFAULT_THRESHOLDS);
    assert.equal(ui.nodes.get("amber-threshold").value, "65");
    assert.equal(ui.nodes.get("rose-threshold").value, "85");
    assert.equal(ui.nodes.get("legend-high").textContent, "85%+");
});

test("polling and conflicts preserve threshold drafts; stale snapshots never revert newly saved colors", async () => {
    const ui = renderer();
    await ui.settle();
    ui.draft(40, 70);
    ui.remoteChange(50, 80);
    await ui.manual();
    assert.equal(ui.nodes.get("amber-threshold").value, "40");
    assert.equal(ui.nodes.get("legend-high").textContent, "80%+");
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
    assert.equal(ui.nodes.get("legend-high").textContent, "90%+");
    ui.release();
    await staleRead;
    assert.equal(ui.nodes.get("legend-high").textContent, "90%+");
    assert.equal(ui.nodes.get("rose-threshold").value, "90");
});

test("parent disclosure shows all nested levels, survives refresh, and search preserves collapse choices", async () => {
    const ui = renderer({ sessions: tree.map((session) => ({ ...session, context: { used: 10, capacity: 100 } })) });
    await ui.settle();
    const articles = () => ui.elements().filter((element) => element.tag === "article");
    const button = (id) => ui.elements().find((element) => element.dataset.action === "fold" && element.dataset.id === id);
    assert.equal(articles().length, 2);
    assert.equal(button("a").textContent, "Expand");
    assert.equal(button("a").attributes.get("aria-expanded"), "false");
    assert.ok(ui.elements().some((element) => element.textContent === "Parent session / 2 nested"));
    ui.fold("a");
    assert.equal(articles().length, 4);
    assert.equal(button("a").textContent, "Collapse");
    assert.equal(button("b").textContent, "Collapse");
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
    assert.equal(button("b").textContent, "Expand");
});
