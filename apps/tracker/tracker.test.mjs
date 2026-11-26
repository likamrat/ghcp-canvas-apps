import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createStore } from "./store.mjs";
import { startServer } from "./server.mjs";
import { readCopilotSessions } from "./sessions.mjs";

test("named boards persist and independent chats cannot overwrite a stale item", async t => {
    const directory = await mkdtemp(join(tmpdir(), "canvas-tracker-"));
    const db = join(directory, "tracker.sqlite");
    t.after(() => rm(directory, { recursive: true }));
    let boardId;
    const coordinator = createStore(db);
    try {
        const worker = createStore(db);
        try {
            ({ id: boardId } = coordinator.run("create_board", { name: "Release readiness" }));
            assert.equal(worker.resolveOpen({ boardName: "release readiness" }).id, boardId);
            assert.throws(() => worker.run("create_board", { name: " RELEASE READINESS " }), { code: "duplicate_board" });
            assert.throws(() => worker.resolveOpen({ boardName: "Missing" }), { code: "board_not_found" });
            const board = worker.run("get_board", { boardId });
            assert.ok(board.statuses.some(status => status.label === "In review"));
            assert.ok(board.statuses.some(status => status.label === "Ready to merge"));

            const { items: [item] } = coordinator.run("add_items", { boardId, items: [{ title: "Smoke test", owner: "Release agent" }] });
            const custom = worker.run("add_status", { boardId, label: "Awaiting sign-off", tooltip: " Waiting for final approval. " });
            const key = { boardId, itemId: item.id, version: item.version };
            const updated = worker.run("update_item", { ...key, changes: { statusId: custom.id, note: "Verified locally." } });
            assert.throws(() => coordinator.run("update_item", { ...key, changes: { statusId: "blocked" } }), { code: "item_changed" });
            assert.throws(() => coordinator.run("remove_item", key), { code: "item_changed" });
            assert.equal(updated.owner, item.owner);
            assert.equal(updated.version, 2);
            assert.deepEqual(coordinator.run("get_board", { boardId }).items, [updated]);
            assert.equal(coordinator.run("get_board", { boardId }).statuses.find(status => status.id === custom.id)?.tooltip,
                "Waiting for final approval.");
        } finally { worker.close(); }
    } finally { coordinator.close(); }
    const reopened = createStore(db);
    try {
        assert.equal(reopened.run("get_board", { boardId }).items[0].note, "Verified locally.");
    } finally { reopened.close(); }
});

test("batch creation is atomic and custom status IDs belong to one tracker", t => {
    const store = createStore(":memory:");
    t.after(() => store.close());
    const { id: boardId } = store.run("create_board", { name: "Release" });
    const { id: otherId } = store.run("create_board", { name: "Documentation" });
    const custom = store.run("add_status", { boardId: otherId, label: "In copyedit" });
    assert.equal(custom.tooltip, null);
    assert.throws(() => store.run("add_status", { boardId, label: "Too long", tooltip: "a".repeat(201) }),
        { code: "invalid_input" });
    assert.throws(() => store.run("add_status", { boardId, label: "ready to merge" }), { code: "duplicate_status" });
    assert.throws(() => store.run("add_items", {
        boardId,
        items: [{ title: "Valid item" }, { title: "Other tracker status", statusId: custom.id }],
    }), { code: "invalid_input" });
    assert.throws(() => store.run("add_items", {
        boardId, items: [{ title: "Invalid link", url: "javascript:alert(1)" }],
    }), { code: "invalid_input" });
    assert.deepEqual(store.run("get_board", { boardId }).items, []);
    const { items: [item] } = store.run("add_items", { boardId, items: [{ title: "Release notes" }] });
    assert.equal(item.statusId, "todo");
    assert.throws(() => store.run("remove_item", { boardId: otherId, itemId: item.id, version: 1 }), { code: "item_changed" });
    store.run("remove_item", { boardId, itemId: item.id, version: 1 });
    assert.deepEqual(store.run("get_board", { boardId }).items, []);
});

test("details stay out of the summary, cannot nest or cross trackers, and prevent accidental removal", t => {
    const store = createStore(":memory:");
    t.after(() => store.close());
    const { id: boardId } = store.run("create_board", { name: "Playback" });
    const { id: otherId } = store.run("create_board", { name: "Packaging" });
    const add = (id, item) => store.run("add_items", { boardId: id, items: [item] }).items[0];
    const summary = add(boardId, { title: "Automatic playback", statusId: "in-progress" });
    const detail = add(boardId, { title: "Handle Escape", parentId: summary.id, statusId: "in-review" });
    assert.deepEqual(store.run("get_board", { boardId }).items, [summary]);
    assert.deepEqual(store.run("get_board", { boardId, includeDetails: true }).items, [summary, detail]);
    assert.throws(() => add(boardId, { title: "Too deep", parentId: detail.id }), { code: "invalid_input" });
    assert.throws(() => add(otherId, { title: "Wrong tracker", parentId: summary.id }), { code: "invalid_input" });
    assert.throws(() => store.run("remove_item", { boardId, itemId: summary.id, version: summary.version }), { code: "item_has_details" });
    store.run("remove_item", { boardId, itemId: detail.id, version: detail.version });
    assert.deepEqual(store.run("get_board", { boardId, includeDetails: true }).items, [summary]);
});

test("upgrading an existing tracker adds Awaiting deployment without replacing an existing custom status", async t => {
    const directory = await mkdtemp(join(tmpdir(), "canvas-tracker-migration-"));
    t.after(() => rm(directory, { recursive: true }));
    const path = join(directory, "tracker.sqlite");
    const store = createStore(path);
    let boardId, item, customBoardId, customStatus;
    try {
        ({ id: boardId } = store.run("create_board", { name: "Existing tracker" }));
        ({ items: [item] } = store.run("add_items", { boardId, items: [{ title: "Keep me", statusId: "done" }] }));
        ({ id: customBoardId } = store.run("create_board", { name: "Tracker with existing deployment status" }));
    } finally { store.close(); }
    const legacy = new DatabaseSync(path);
    try {
        legacy.exec(`DELETE FROM statuses WHERE id = 'awaiting-deployment';
            DROP INDEX items_by_parent; ALTER TABLE items DROP COLUMN parentId;
            ALTER TABLE items DROP COLUMN hidden;
            ALTER TABLE boards DROP COLUMN sessionId; ALTER TABLE boards DROP COLUMN sessionName;
            ALTER TABLE statuses DROP COLUMN tooltip`);
        customStatus = "custom-deployment";
        legacy.prepare("INSERT INTO statuses (boardId, id, label, labelKey, tone) VALUES (?, ?, ?, ?, ?)")
            .run(customBoardId, customStatus, "Awaiting Deployment", "awaiting deployment", "neutral");
    } finally { legacy.close(); }
    const upgraded = createStore(path);
    try {
        const board = upgraded.run("get_board", { boardId });
        assert.deepEqual(board.items, [item]);
        assert.equal(board.board.sessionId, null);
        assert.equal(board.statuses.find(status => status.id === "done")?.tooltip, null);
        const mergeIndex = board.statuses.findIndex(status => status.id === "ready-to-merge");
        assert.equal(board.statuses[mergeIndex + 1]?.id, "awaiting-deployment");
        assert.equal(upgraded.run("update_item", {
            boardId, itemId: item.id, version: item.version, changes: { statusId: "awaiting-deployment" },
        }).statusId, "awaiting-deployment");
        const customBoard = upgraded.run("get_board", { boardId: customBoardId });
        assert.deepEqual(customBoard.statuses.filter(status => status.label.toLowerCase() === "awaiting deployment")
            .map(status => status.id), [customStatus]);
        assert.equal(upgraded.run("add_items", { boardId, items: [{ title: "New detail", parentId: item.id }] }).items[0].parentId,
            item.id);
    } finally { upgraded.close(); }
});

test("linking resolves stable workspace IDs from session aliases and allows unlinked boards", async t => {
    const directory = await mkdtemp(join(tmpdir(), "canvas-tracker-sessions-"));
    t.after(() => rm(directory, { recursive: true }));
    const path = join(directory, "data.db");
    const appDb = new DatabaseSync(path);
    try {
        appDb.exec(`
            CREATE TABLE workspaces (id TEXT, name TEXT, session_id TEXT);
            CREATE TABLE sessions (id TEXT, title TEXT, archived_at TEXT);
            CREATE TABLE workspace_session_aliases (session_id TEXT, workspace_id TEXT);
            INSERT INTO workspaces VALUES ('work-id', 'Workspace title', 'current-id');
            INSERT INTO sessions VALUES ('current-id', 'Runtime title', NULL), ('old-id', 'Previous title', NULL),
                ('chat-id', 'Standalone chat', '2026-05-01');
            INSERT INTO workspace_session_aliases VALUES ('old-id', 'work-id');
        `);
    } finally { appDb.close(); }
    const store = createStore(":memory:", { readSessions: () => readCopilotSessions(path) });
    try {
        assert.deepEqual(store.run("list_sessions", {}, "old-id").sessions, [
            { id: "work-id", name: "Workspace title", archived: false, current: true },
            { id: "chat-id", name: "Standalone chat", archived: true, current: false },
        ]);
        const board = store.run("create_board", { name: "Linked", sessionId: "old-id" });
        assert.equal(board.sessionId, "work-id");
        assert.equal(board.sessionName, "Workspace title");
        assert.deepEqual(store.run("list_boards").boards, [board]);
        assert.deepEqual(store.run("get_board", { boardId: board.id }).board, board);
        assert.throws(() => store.run("set_board_session", { boardId: board.id, sessionId: "unknown" }),
            { code: "copilot_session_not_found" });
        assert.equal(store.run("get_board", { boardId: board.id }).board.sessionId, "work-id");
        assert.equal(store.run("set_board_session", { boardId: board.id, sessionId: "" }).sessionId, null);
        assert.equal(store.run("create_board", { name: "Unlinked" }).sessionName, null);
    } finally { store.close(); }
});

test("release statuses backfill saved trackers and preserve an existing custom status and its items", async t => {
    const root = await mkdtemp(join(tmpdir(), "tracker-release-statuses-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, "tracker.sqlite");
    const original = createStore(path);
    const { id: boardId } = original.run("create_board", { name: "Release checklist" });
    original.close();
    const legacy = new DatabaseSync(path);
    legacy.prepare("DELETE FROM statuses WHERE boardId = ? AND id IN ('verified-live', 'packaged')").run(boardId);
    legacy.prepare(`INSERT INTO statuses (boardId, id, label, labelKey, tone, tooltip)
        VALUES (?, 'custom-live', 'Verified Live', 'verified live', 'neutral', 'Checked the running service.')`).run(boardId);
    legacy.prepare(`INSERT INTO items (id, boardId, statusId, title, owner, note, url, createdAt, updatedAt)
        VALUES ('release', ?, 'custom-live', 'Check the release', '', '', '', '2025-01-15', '2025-01-15')`).run(boardId);
    legacy.close();

    const upgraded = createStore(path);
    try {
        const { statuses, items } = upgraded.run("get_board", { boardId });
        const live = statuses.filter(status => /^verified live$/i.test(status.label));
        assert.deepEqual(live.map(({ id, tone, tooltip }) => ({ id, tone, tooltip })), [
            { id: "custom-live", tone: "green", tooltip: "Checked the running service." },
        ]);
        assert.equal(items[0].statusId, "custom-live");
        assert.equal(statuses.find(status => status.id === "packaged").tone, "blue");
        const { id: freshId } = upgraded.run("create_board", { name: "Next release" });
        assert.equal(upgraded.run("get_board", { boardId: freshId }).statuses.find(status => status.id === "verified-live").tone, "green");
    } finally { upgraded.close(); }
});

test("item visibility is reversible, persists across views, and rejects stale edits", async t => {
    const root = await mkdtemp(join(tmpdir(), "tracker-visibility-"));
    const first = createStore(join(root, "tracker.sqlite"));
    const second = createStore(join(root, "tracker.sqlite"));
    t.after(async () => { first.close(); second.close(); await rm(root, { recursive: true, force: true }); });
    const { id: boardId } = first.run("create_board", { name: "Release checklist" });
    const { items: [item] } = first.run("add_items", { boardId, items: [{ title: "Test update", statusId: "done" }] });
    const key = { boardId, itemId: item.id, version: item.version };
    const hidden = first.run("update_item", { ...key, changes: { hidden: true } });
    assert.equal(hidden.hidden, true);
    assert.equal(second.run("get_board", { boardId }).items[0].hidden, true);
    assert.throws(() => second.run("update_item", { ...key, changes: { hidden: false } }), { code: "item_changed" });
    const restored = second.run("update_item", { ...key, version: hidden.version, changes: { hidden: false } });
    assert.equal(restored.hidden, false);
    assert.equal(restored.statusId, "done");
    assert.equal(first.run("get_board", { boardId }).items[0].hidden, false);
});

test("the canvas can delete a tracker with subtasks without affecting other trackers", async t => {
    const store = createStore(":memory:");
    const server = await startServer(store);
    t.after(async () => { await server.close(); store.close(); });
    const { id: boardId } = store.run("create_board", { name: "Release checklist" });
    const { id: keepId } = store.run("create_board", { name: "Design review" });
    const { id: customStatus } = store.run("add_status", { boardId, label: "Needs sign-off" });
    const { items: [parent] } = store.run("add_items", { boardId, items: [{ title: "Test update", statusId: customStatus }] });
    store.run("add_items", { boardId, items: [{ title: "Test on Windows", parentId: parent.id }] });
    const { items: [keep] } = store.run("add_items", { boardId: keepId, items: [{ title: "Check keyboard navigation" }] });

    const html = await (await fetch(server.url)).text();
    const token = html.match(/name="tracker-token" content="([^"]+)"/)[1];
    const remove = (value) => fetch(new URL("/api/delete-board", server.url), {
        method: "POST",
        headers: { "content-type": "application/json", "x-tracker-token": value },
        body: JSON.stringify({ boardId }),
    });
    assert.equal((await remove("invalid")).status, 403);
    assert.equal(store.run("get_board", { boardId, includeDetails: true }).items.length, 2);
    assert.equal((await remove(token)).status, 200);
    assert.throws(() => store.run("get_board", { boardId }), { code: "board_not_found" });
    assert.deepEqual(store.run("get_board", { boardId: keepId }).items, [keep]);
    assert.equal((await remove(token)).status, 404);
    assert.notEqual(store.run("create_board", { name: "Release checklist" }).id, boardId);
});

test("canvas HTTP calls share the agent store and keep the named board in the browser popout", async t => {
    const store = createStore(":memory:");
    let opened;
    const server = await startServer(store, { launchBrowser: async (url) => { opened = new URL(url); return { mode: "browser" }; } });
    t.after(async () => { await server.close(); store.close(); });
    const html = await (await fetch(server.url)).text();
    const token = html.match(/name="tracker-token" content="([^"]+)"/)[1];
    const headers = { "content-type": "application/json", "x-tracker-token": token };
    const post = (path, body, extra) => fetch(new URL(path, server.url), {
        method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body),
    });
    const payload = { action: "create_board", input: { name: "Browser board" } };
    assert.equal((await post("/api", payload, { "x-tracker-token": "missing" })).status, 403);
    assert.equal((await post("/api", payload, { origin: "https://example.test" })).status, 403);
    assert.deepEqual(store.run("list_boards").boards, []);
    const response = await post("/api", payload);
    assert.equal(response.status, 200);
    const { id: boardId } = await response.json();
    assert.equal(store.resolveOpen({ boardId }).name, "Browser board");
    assert.equal((await post("/api/open-browser", { boardId })).status, 200);
    assert.equal(opened.searchParams.get("board"), boardId);
    assert.equal(opened.searchParams.get("view"), "browser");
});
