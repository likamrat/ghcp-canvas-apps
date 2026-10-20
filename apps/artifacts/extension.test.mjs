import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { queryArtifacts, KINDS, SOURCES } from "./model.mjs";

async function load(catalog) {
    let canvas;
    const opened = [];
    const source = (await readFile(new URL("extension.mjs", import.meta.url), "utf8")).replace(/^import .*;\r?\n/gm, "");
    await runInNewContext(`(async () => { ${source}\n })()`, {
        joinSession: async options => { canvas = options.canvases[0]; },
        createCanvas: options => ({ ...options, declaration: {} }),
        CanvasError: class extends Error { constructor(code, message) { super(message); this.code = code; } },
        createCatalog: () => catalog, queryArtifacts, KINDS, SOURCES,
        startServer: async (_catalog, options) => { opened.push(options.sessionId); return { url: "http://127.0.0.1:12345/" }; },
    });
    return { canvas, opened, action: name => canvas.actions.find(action => action.name === name) };
}

test("extension actions use the current session, filter metadata, and bound text responses", async () => {
    const id = "a".repeat(64);
    const records = [{ id, title: "Plan", name: "plan.md", kind: "document", source: "published", timestamp: null, pinned: true }];
    const publications = [];
    const catalog = {
        sessions: preferred => ({ defaultSessionId: preferred }),
        artifacts: async () => ({ sessionId: "current", artifacts: records, warnings: [], collectedAt: "2026-10-20T13:00:00Z" }),
        read: async () => ({ metadata: records[0], content: "1234567890", bytes: null }),
        publish: async input => { publications.push(input); return records[0]; },
    };
    const { canvas, action, opened } = await load(catalog);
    assert.equal(canvas.id, "artifacts");
    assert.ok(canvas.actions.every(action => action.inputSchema.additionalProperties === false && !action.name.startsWith("canvas.")));
    await canvas.open({ instanceId: "one", sessionId: "current" });
    await canvas.open({ instanceId: "two", sessionId: "current", input: { sessionId: "chosen" } });
    assert.deepEqual(opened, ["current", "chosen"]);
    assert.equal((await action("list_sessions").handler({ sessionId: "current" })).defaultSessionId, "current");
    const result = await action("query_artifacts").handler({ input: { sessionId: "current", kinds: ["document"], search: "plan", limit: 1 } });
    assert.equal(result.matching, 1);
    assert.equal(result.artifacts[0].id, id);
    const page = await action("read_artifact").handler({ input: { id, offset: 2, limit: 3 } });
    assert.equal(page.content, "345");
    assert.equal(page.totalCharacters, 10);
    assert.equal(page.more, true);
    assert.equal(Object.hasOwn(page, "bytes"), false);
    await action("register_artifact").handler({ sessionId: "current", input: { title: "Plan", content: "Text" } });
    await action("register_artifact").handler({ sessionId: "current", input: { sessionId: "chosen", title: "Plan", content: "Text" } });
    assert.deepEqual(publications.map(input => input.sessionId), ["current", "chosen"]);
});

test("extension failures preserve actionable error codes and binary reads return no payload", async () => {
    const { action } = await load({
        metadata: () => { throw Object.assign(new Error("Artifact not loaded"), { code: "artifact_missing" }); },
        read: async () => ({ metadata: { id: "a".repeat(64) }, content: null, bytes: Buffer.from("private image bytes") }),
    });
    await assert.rejects(action("get_artifact").handler({ input: { id: "a".repeat(64) } }), error => error.code === "artifact_missing");
    const result = await action("read_artifact").handler({ input: { id: "a".repeat(64) } });
    assert.equal(result.content, null);
    assert.equal(result.totalCharacters, 0);
    assert.equal(Object.hasOwn(result, "bytes"), false);
});
