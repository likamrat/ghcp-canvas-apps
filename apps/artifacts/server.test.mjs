import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./server.mjs";
import { createCatalog } from "./source.mjs";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("the server scopes reads, publishes only JSON, and exposes no arbitrary file path", async t => {
    const id = "a".repeat(64), calls = [];
    const catalog = {
        sessions: preferred => ({ defaultSessionId: preferred, sessions: [] }),
        artifacts: async (sessionId, options) => { calls.push([sessionId, options]); return { artifacts: [] }; },
        read: async (_id, { version }) => ({ metadata: { id, kind: "document" }, content: `Revision ${version}`, bytes: null, mime: "text/plain", filename: "note.md" }),
        revisions: () => [{ version: 1 }],
        publish: async input => input,
        pin: () => ({ id, pinned: true }),
    };
    const server = await startServer(catalog, { sessionId: "current" });
    t.after(() => server.close());
    const url = path => new URL(path, server.url);
    assert.equal((await (await fetch(url("api/sessions"))).json()).defaultSessionId, "current");
    assert.equal((await fetch(url("api/artifacts?sessionId=child&includeChildren=true"))).status, 200);
    assert.deepEqual(calls, [["child", { includeChildren: true, includeArchived: false }]]);
    assert.equal((await fetch(url("api/artifacts?sessionId=child&includeChildren=maybe"))).status, 400);
    assert.equal((await fetch(url("api/artifacts?sessionId=a&sessionId=b"))).status, 400);
    assert.equal((await fetch(url("api/artifacts?path=C:\\secret"))).status, 400);
    const content = await (await fetch(url(`api/content/${id}?version=1`))).json();
    assert.equal(content.content, "Revision 1");
    assert.equal(content.bytes, undefined);
    assert.equal((await fetch(url(`api/content/${id}?version=0`))).status, 400);
    const file = await fetch(url(`file/${id}?download=true`));
    assert.match(file.headers.get("content-disposition"), /^attachment;/);
    assert.match(file.headers.get("content-security-policy"), /^sandbox;/);
    const write = await fetch(url("api/publish"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: "current", title: "Note", content: "Hello" }) });
    assert.equal(write.status, 200);
    assert.equal((await fetch(url("api/publish"), { method: "POST", body: "{}" })).status, 400);
    assert.equal((await fetch(url("api/pin"), { method: "POST", headers: { "content-type": "application/json" }, body: '{"id":"x","extra":true}' })).status, 400);
    assert.equal((await fetch(new URL("/", server.url))).status, 403);
    assert.equal((await fetch(server.url, { headers: { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "iframe" } })).status, 200);
    assert.equal((await fetch(url("api/sessions"), { headers: { Origin: "https://example.com" } })).status, 403);
    assert.equal((await fetch(url("api/sessions"), { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
    assert.equal((await fetch(url("api/sessions"), { method: "DELETE" })).status, 405);
});

test("the app header embeds a transparent wordmark with theme-aware lettering", async t => {
    const server = await startServer({});
    t.after(() => server.close());
    const response = await fetch(server.url);
    assert.equal(response.status, 200);
    const html = await response.text();
    const header = html.match(/<h1 class="app-wordmark"[\s\S]*?<\/h1>/)?.[0];
    assert.ok(header, "Render the wordmark inside the accessible app heading");
    assert.match(header, /aria-label="Artifacts"/);
    assert.match(header, /<svg[^>]+aria-hidden="true"/);
    assert.match(header, /viewBox="52 52 552 120"/);
    assert.match(header, /class="word-prefix" fill="currentColor"/);
    assert.match(header, /class="word-suffix" fill="currentColor"/);
    assert.doesNotMatch(header, /<img|<rect|__APP_WORDMARK__/);
    assert.match(header, /<path d="M2 11h20"/);
    const css = await (await fetch(new URL("branding.css", server.url))).text();
    assert.match(css, /\.app-wordmark[^}]*color:\s*var\(--ink,/);
});

test("downloads save exact binary, UTF-8, and captured-revision bytes with original filenames", async t => {
    const home = await mkdtemp(join(tmpdir(), "artifacts-download-"));
    const db = new DatabaseSync(join(home, "data.db"));
    db.exec("CREATE TABLE sessions (id TEXT, title TEXT, execution_location TEXT); INSERT INTO sessions VALUES ('example','Downloads','local');");
    db.close();
    const source = join(home, "session-state", "example", "files");
    const destination = join(home, "downloads");
    await mkdir(source, { recursive: true });
    await mkdir(destination);
    const samples = [
        ["capture.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64")],
        ["r\u00e9sultats.csv", Buffer.from("Name,Result\nCaf\u00e9,Ready\n", "utf8")],
        ["flow.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="5"/></svg>')],
    ];
    for (const [name, bytes] of samples) await writeFile(join(source, name), bytes);
    const catalog = createCatalog({ home });
    const first = await catalog.publish({ sessionId: "example", title: "Release notes", content: "# Release\n\nFirst \u00e9dition.\n" });
    await catalog.publish({ sessionId: "example", id: first.id, expectedVersion: first.version, title: "Release notes", content: "# Release\n\nSecond edition.\n" });
    const snapshot = await catalog.artifacts("example");
    const server = await startServer(catalog, { sessionId: "example" });
    t.after(async () => { await server.close(); catalog.close(); await rm(home, { recursive: true, force: true }); });
    for (const [name, bytes] of [...samples, ["Release notes.md", Buffer.from("# Release\n\nFirst \u00e9dition.\n", "utf8")]]) {
        const item = snapshot.artifacts.find(record => record.name === name);
        assert.ok(item, `Discover ${name}`);
        const revision = item.source === "published" ? "&version=1" : "";
        const response = await fetch(new URL(`file/${item.id}?download=true${revision}`, server.url));
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-disposition"), /^attachment;/);
        const filename = response.headers.get("content-disposition").match(/filename\*=UTF-8''(.+)$/)?.[1];
        assert.equal(decodeURIComponent(filename), name, `Keep ${name}`);
        const saved = join(destination, name);
        await writeFile(saved, Buffer.from(await response.arrayBuffer()));
        assert.deepEqual(await readFile(saved), bytes, `Save exact ${name} bytes`);
        assert.equal(Number(response.headers.get("content-length")), bytes.length);
    }
    const missing = snapshot.artifacts.find(record => record.name === "capture.png");
    await rm(join(source, missing.name));
    const response = await fetch(new URL(`file/${missing.id}?download=true`, server.url));
    assert.notEqual(response.status, 200);
    assert.equal(response.headers.get("content-disposition"), null);
    assert.ok((await response.json()).error);
});
