import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "./store.mjs";
import { startServer } from "./server.mjs";

test("saved ideas survive reopen; independent connections reject stale edits", () => {
    const directory = mkdtempSync(join(tmpdir(), "idea-inbox-test-"));
    const path = join(directory, "ideas.sqlite");
    let first;
    let second;
    try {
        first = createStore(path);
        second = createStore(path);
        assert.deepEqual(first.run("list", {}), { items: [] });
        const added = first.run("add", { text: "  Try a keyboard shortcut\nKeep the note  " });
        assert.equal(second.run("list", {}).items[0].text, "Try a keyboard shortcut\nKeep the note");
        const id = added.id;
        first.run("update", { id, version: 1, done: true });
        assert.throws(() => second.run("update", { id, version: 1, text: "Stale" }), { code: "item_changed" });
        second.run("update", { id, version: 2, text: "<script>not markup</script>", done: false });
        first.close();
        first = createStore(path);
        const item = first.run("list", {}).items[0];
        assert.equal(item.id, id);
        assert.equal(item.done, false);
        assert.equal(item.version, 3);
        assert.equal(item.text, "<script>not markup</script>");
        for (const text of [" ", "", "x".repeat(4001), null]) {
            assert.throws(() => first.run("add", { text }), { code: "invalid_input" });
        }
        assert.throws(() => first.run("update", { id, version: 3, done: "yes" }), { code: "invalid_input" });
        assert.throws(() => first.run("list", { unknown: true }), { code: "invalid_input" });
        assert.equal(first.run("list", {}).items.length, 1);
    } finally {
        first?.close();
        second?.close();
        rmSync(directory, { recursive: true });
    }
});

test("deleting a thought persists across restart and keeps other thoughts", () => {
    const directory = mkdtempSync(join(tmpdir(), "thoughts-delete-test-"));
    const path = join(directory, "thoughts.sqlite");
    let store = createStore(path);
    try {
        store.run("add", { text: "Keep this thought" });
        const removed = store.run("add", { text: "Delete this thought" });
        store.run("delete", { id: removed.id, version: 1 });
        store.close();
        store = createStore(path);
        assert.deepEqual(store.run("list", {}).items.map((item) => item.text), ["Keep this thought"]);
    } finally {
        store.close();
        rmSync(directory, { recursive: true });
    }
});

test("a stale deletion keeps a thought edited in another connection", () => {
    const directory = mkdtempSync(join(tmpdir(), "thoughts-stale-delete-test-"));
    const path = join(directory, "thoughts.sqlite");
    const first = createStore(path);
    const second = createStore(path);
    try {
        const thought = first.run("add", { text: "Original thought" });
        second.run("update", { id: thought.id, version: 1, text: "Updated in another chat", done: true });
        assert.throws(() => first.run("delete", { id: thought.id, version: 1 }), { code: "item_changed" });
        assert.equal(first.run("list", {}).items[0].text, "Updated in another chat");
        first.run("delete", { id: thought.id, version: 2 });
        assert.deepEqual(second.run("list", {}).items, []);
    } finally {
        first.close();
        second.close();
        rmSync(directory, { recursive: true });
    }
});

test("loopback renderer routes validate origin, token, body and stale writes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "idea-inbox-http-test-"));
    const store = createStore(join(directory, "ideas.sqlite"));
    const entry = await startServer(store);
    try {
        const response = await fetch(entry.url);
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.match(html, /<title>Thoughts<\/title>/);
        assert.match(html, /<h1>Thoughts<\/h1>/);
        const token = html.match(/name="inbox-token" content="([a-f0-9]+)"/)[1];
        const headers = { "Content-Type": "application/json", "X-Inbox-Token": token };
        const post = (payload, extra = {}) => fetch(`${entry.url}api`, {
            method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(payload),
        });
        assert.equal((await post({ action: "list", input: {} }, { Origin: "https://example.com" })).status, 403);
        assert.equal((await post({ action: "list", input: {} }, { "X-Inbox-Token": "bad" })).status, 403);
        assert.equal((await post({ action: "add", input: { text: " " } })).status, 400);
        const added = await (await post({ action: "add", input: { text: "HTTP idea" } })).json();
        assert.equal(added.items.length, 1);
        const update = { action: "update", input: { id: added.id, version: 1, done: true } };
        assert.equal((await post(update)).status, 200);
        assert.equal((await post(update)).status, 409);
        assert.equal((await post({ action: "delete", input: { id: added.id } })).status, 400);
        assert.equal((await post({ action: "delete", input: { id: added.id, version: 1 } })).status, 409);
        const deleted = await post({ action: "delete", input: { id: added.id, version: 2 } });
        assert.equal(deleted.status, 200);
        assert.deepEqual((await deleted.json()).items, []);
        assert.deepEqual((await (await post({ action: "list", input: {} })).json()).items, []);
        assert.equal((await fetch(`${entry.url}missing`)).status, 404);
        assert.equal((await fetch(`${entry.url}app.js`)).status, 200);
    } finally {
        await entry.close();
        store.close();
        rmSync(directory, { recursive: true });
    }
});
