import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCatalog } from "./source.mjs";

async function fixture(t) {
    const home = await mkdtemp(join(process.cwd(), ".artifacts-store-fixture-"));
    const catalogs = [];
    t.after(async () => {
        for (const catalog of catalogs) catalog.close();
        await rm(home, { recursive: true, force: true });
    });
    const db = new DatabaseSync(join(home, "data.db"));
    db.exec("CREATE TABLE sessions (id TEXT, execution_location TEXT); INSERT INTO sessions VALUES ('local', 'local'), ('other', 'local'), ('cloud', 'cloud');");
    db.close();
    return () => {
        const catalog = createCatalog({ home });
        catalogs.push(catalog);
        return catalog;
    };
}

test("published Markdown survives reopen with immutable captured revisions and stable identity", async (t) => {
    const open = await fixture(t);
    const first = open();
    const note = await first.publish({ sessionId: "local", title: "A / safe : brief", content: "  # First\n" });
    assert.match(note.id, /^[a-f0-9]{64}$/);
    assert.equal(note.source, "published");
    assert.equal(note.version, 1);
    assert.equal(note.path, null);
    assert.ok(!/[\\/:]/.test(note.name));
    const revised = await first.publish({ sessionId: "local", id: note.id, expectedVersion: 1, title: "Revised", content: "# Second" });
    assert.equal(revised.version, 2);
    assert.equal((await first.read(note.id, { version: 1 })).content, "  # First\n");
    assert.equal((await first.read(note.id)).content, "# Second");
    assert.deepEqual(first.revisions(note.id).map((row) => [row.version, row.title]), [[2, "Revised"], [1, "A / safe : brief"]]);
    first.close();
    const second = open();
    const result = await second.artifacts("local");
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0].id, note.id);
    assert.equal(result.artifacts[0].version, 2);
    assert.equal((await second.read(note.id, { version: 1 })).content, "  # First\n");
});

test("publication validation and concurrent edits preserve original content and ownership", async (t) => {
    const open = await fixture(t);
    const first = open(), second = open();
    const input = { sessionId: "local", title: "Note", content: "Original" };
    for (const invalid of [
        null, { ...input, title: "" }, { ...input, title: " " }, { ...input, title: "x".repeat(201) },
        { ...input, content: 12 }, { ...input, content: "é".repeat(524289) },
        { ...input, expectedVersion: 1 }, { ...input, id: "bad", expectedVersion: 1 },
        { ...input, id: "a".repeat(64) }, { ...input, unknown: true },
    ]) await assert.rejects(first.publish(invalid), { code: "invalid_input" });
    await assert.rejects(first.publish({ ...input, sessionId: "cloud" }), { code: "session_unavailable" });
    await assert.rejects(first.publish({ ...input, sessionId: "absent" }), { code: "session_missing" });
    const original = await first.publish(input);
    const update = { ...input, id: original.id, expectedVersion: 1, content: "Next" };
    await assert.rejects(second.publish({ ...update, sessionId: "other" }), { code: "version_conflict" });
    await second.publish(update);
    await assert.rejects(first.publish(update), { code: "version_conflict" });
    await assert.rejects(first.read(original.id, { version: 0 }), { code: "invalid_input" });
    await assert.rejects(first.read(original.id, { version: 9 }), { code: "version_missing" });
    assert.equal((await first.read(original.id, { version: 1 })).content, "Original");
    assert.equal((await first.read(original.id)).content, "Next");
    assert.equal(first.metadata(original.id).version, 2);
    assert.throws(() => first.revisions("a".repeat(64)), { code: "artifact_missing" });
});
