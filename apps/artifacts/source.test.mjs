import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm, truncate, symlink, chmod, utimes, stat } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createCatalog } from "./source.mjs";

export async function fixture(t) {
    const home = await mkdtemp(join(process.cwd(), ".artifacts-fixture-"));
    const catalogs = [];
    t.after(async () => {
        for (const catalog of catalogs) catalog.close();
        await rm(home, { recursive: true, force: true });
    });
    const db = new DatabaseSync(join(home, "data.db"));
    db.exec(`
        CREATE TABLE sessions (id TEXT, title TEXT, updated_at TEXT, archived_at TEXT, execution_location TEXT);
        CREATE TABLE workspaces (id TEXT, name TEXT, project_id TEXT, session_id TEXT, creator_session_id TEXT, archived_at TEXT);
        CREATE TABLE workspace_session_aliases (session_id TEXT, workspace_id TEXT);
        INSERT INTO sessions VALUES ('current', 'Current', '2026-10-14', NULL, 'local');
        INSERT INTO workspaces VALUES ('workspace', 'Artifacts work', NULL, 'current', NULL, NULL);
        INSERT INTO workspace_session_aliases VALUES ('previous', 'workspace');
    `);
    db.close();
    const open = () => {
        const catalog = createCatalog({ home });
        catalogs.push(catalog);
        return catalog;
    };
    const events = async (id, entries) => {
        const directory = join(home, "session-state", id);
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "events.jsonl"), entries.map(JSON.stringify).join("\n") + "\n");
    };
    const file = async (id, name, content) => {
        const directory = join(home, "session-state", id, "files");
        await mkdir(directory, { recursive: true });
        const path = join(directory, name);
        await writeFile(path, content);
        return path;
    };
    return { home, open, events, file };
}

test("aliases select one canonical session and discover only its deliverable files", async (t) => {
    const { home, open, file } = await fixture(t);
    await file("previous", "Brief.md", "# A real brief");
    await file("unrelated", "Secret.md", "Not in this scope");
    await writeFile(join(home, "outside.md"), "Not an artifact");
    const catalog = open();
    assert.equal(catalog.sessions("workspace").defaultSessionId, "current");
    assert.equal(catalog.sessions().sessions.length, 1);
    const result = await catalog.artifacts("previous");
    assert.equal(result.sessionId, "current");
    assert.equal(result.artifacts.length, 1);
    const item = result.artifacts[0];
    assert.equal(item.name, "Brief.md");
    assert.equal(item.source, "session-file");
    assert.equal(item.kind, "document");
    assert.equal(item.version, null);
    assert.match(item.id, /^[a-f0-9]{64}$/);
    assert.equal((await catalog.read(item.id)).content, "# A real brief");
});

test("Markdown images resolve relative to the indexed document without adding unrelated artifacts", async t => {
    const { home, open, events } = await fixture(t);
    const folder = join(home, "documents");
    await mkdir(join(folder, "images"), { recursive: true });
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    await writeFile(join(folder, "images", "preview image.png"), bytes);
    const path = join(folder, "README.md");
    await writeFile(path, '<a href="images/preview%20image.png"><img src="images/preview%20image.png" alt="Preview"></a>');
    await events("current", [{ type: "user.message", data: { attachments: [{ type: "file", path }] } }]);
    const catalog = open(), snapshot = await catalog.artifacts("current");
    assert.equal(snapshot.artifacts.length, 1);
    const result = await catalog.readResource(snapshot.artifacts[0].id, "images/preview%20image.png");
    assert.deepEqual(result.bytes, bytes);
    assert.equal(result.mime, "image/png");
    assert.equal(result.filename, "preview image.png");
    assert.equal((await catalog.artifacts("current")).artifacts.length, 1);
});

test("Markdown image reads reject undeclared files, traversal, hidden paths, network paths, and symlinks", async t => {
    const { home, open, events } = await fixture(t);
    const folder = join(home, "documents"), outside = join(home, "outside");
    await mkdir(join(folder, ".hidden"), { recursive: true });
    await mkdir(join(folder, "secrets"));
    await mkdir(outside);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    for (const path of [join(folder, "unlisted.svg"), join(folder, ".hidden", "image.svg"),
        join(folder, "secrets", "image.svg"), join(outside, "image.svg")]) await writeFile(path, svg);
    await symlink(outside, join(folder, "linked"), "junction");
    await symlink(join(folder, ".hidden"), join(folder, "alias"), "junction");
    const refs = ["../outside/image.svg", "%2e%2e/outside/image.svg", ".hidden/image.svg",
        "secrets/image.svg", "linked/image.svg", "alias/image.svg", "https://example.com/image.svg", "\\\\server\\image.svg"];
    const path = join(folder, "README.md");
    await writeFile(path, refs.map(ref => `<img src="${ref}">`).join("\n"));
    await events("current", [{ type: "user.message", data: { attachments: [{ type: "file", path }] } }]);
    const catalog = open(), snapshot = await catalog.artifacts("current"), id = snapshot.artifacts[0].id;
    for (const ref of [...refs, "unlisted.svg"]) {
        await assert.rejects(catalog.readResource(id, ref), error =>
            ["invalid_input", "unsafe_path", "resource_missing", "resource_unavailable"].includes(error.code), ref);
    }
});

test("linked image changes require refresh and Markdown revisions authorize their own references", async t => {
    const { home, open, events, file } = await fixture(t);
    const folder = join(home, "documents");
    await mkdir(folder);
    const path = join(folder, "README.md"), image = join(folder, "flow.svg");
    await writeFile(path, "![Flow](flow.svg)");
    await writeFile(image, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await events("current", [{ type: "user.message", data: { attachments: [{ type: "file", path }] } }]);
    const catalog = open(), snapshot = await catalog.artifacts("current"), id = snapshot.artifacts[0].id;
    await catalog.readResource(id, "flow.svg");
    const changed = '<svg xmlns="http://www.w3.org/2000/svg"><title>Updated</title></svg>';
    await writeFile(image, changed);
    await assert.rejects(catalog.readResource(id, "flow.svg"), { code: "artifact_changed" });
    await catalog.artifacts("current");
    assert.equal((await catalog.readResource(id, "flow.svg")).bytes.toString(), changed);
    await file("current", "note-image.svg", changed);
    const note = await catalog.publish({ sessionId: "current", title: "Note", content: "![Image](note-image.svg)" });
    await catalog.publish({ sessionId: "current", id: note.id, expectedVersion: 1, title: "Note", content: "No image in this version." });
    await catalog.artifacts("current");
    assert.equal((await catalog.readResource(note.id, "note-image.svg", { version: 1 })).bytes.toString(), changed);
    await assert.rejects(catalog.readResource(note.id, "note-image.svg"), { code: "resource_missing" });
});

test("Markdown previews bound their image reference count", async t => {
    const { open, file } = await fixture(t);
    await file("current", "README.md", Array.from({ length: 129 }, (_, index) => `![Image](image-${index}.png)`).join("\n"));
    const catalog = open(), snapshot = await catalog.artifacts("current");
    await assert.rejects(catalog.readResource(snapshot.artifacts[0].id, "image-0.png"), { code: "resource_too_large" });
});

test("scope reloads current hierarchy, excludes archives, and warns rather than scanning remote files", async (t) => {
    const { home, open, file } = await fixture(t);
    const catalog = open();
    catalog.sessions();
    const db = new DatabaseSync(join(home, "data.db"));
    db.exec(`
        INSERT INTO sessions VALUES ('child', 'Child', NULL, NULL, 'local'), ('archived', 'Archived', NULL, '2026-10-14', 'local'),
            ('remote', 'Remote', NULL, NULL, 'cloud');
        CREATE TABLE session_side_chats (session_id TEXT, parent_session_id TEXT);
        INSERT INTO session_side_chats VALUES ('child', 'workspace'), ('archived', 'child'), ('remote', 'workspace');
    `);
    db.close();
    for (const id of ["current", "child", "archived", "remote"]) await file(id, `${id}.md`, id);
    await assert.rejects(catalog.artifacts("current", { includeChildren: "yes" }), { code: "invalid_input" });
    assert.equal((await catalog.artifacts("current")).artifacts.length, 1);
    const children = await catalog.artifacts("workspace", { includeChildren: true });
    assert.deepEqual(children.artifacts.map((row) => row.sessionId), ["current", "child"]);
    assert.ok(children.warnings.some((warning) => /cloud/.test(warning)));
    assert.equal((await catalog.artifacts("current", { includeChildren: true, includeArchived: true })).artifacts.length, 3);
    assert.equal((await catalog.artifacts("archived")).artifacts.length, 0);
    await assert.rejects(catalog.artifacts("absent"), { code: "session_missing" });
});

test("structured attachments and successful file tools discover deliverables without claiming views generated them", async (t) => {
    const { home, open, events, file } = await fixture(t);
    const report = await file("current", "report.md", "# Report");
    const upload = join(home, "upload.csv");
    await writeFile(upload, "a,b\n1,2");
    const generated = join(home, "created.json");
    await writeFile(generated, "{}");
    const viewed = join(home, "viewed.txt");
    await writeFile(viewed, "Existing");
    await events("previous", [
        { type: "session.start", data: { context: { cwd: home } } },
        { type: "user.message", data: { content: "Ignore shell.md and random.txt", attachments: [{ type: "file", path: upload }] } },
        { type: "tool.execution_start", data: { toolCallId: "read", toolName: "view", arguments: { path: viewed } } },
        { type: "tool.execution_complete", id: "view-event", data: { toolCallId: "read", success: true, result: { content: "created other.md" } } },
        { type: "tool.execution_start", data: { toolCallId: "patch", toolName: "apply_patch", arguments: "*** Begin Patch\n*** Add File: created.json\n+{}\n*** Update File: session-state/current/files/report.md\n@@\n-old\n+new\n*** End Patch" } },
        { type: "tool.execution_complete", data: { toolCallId: "patch", success: true } },
        { type: "tool.execution_start", data: { toolCallId: "failed", toolName: "create", arguments: { path: "failed.md" } } },
        { type: "tool.execution_complete", data: { toolCallId: "failed", success: false } },
        { type: "tool.execution_start", data: { toolCallId: "missing", toolName: "create", arguments: { path: "removed.pdf" } } },
        { type: "tool.execution_complete", data: { toolCallId: "missing", success: true } },
    ]);
    await appendFile(join(home, "session-state", "previous", "events.jsonl"), '{"incomplete":');
    const catalog = open();
    const result = await catalog.artifacts("workspace");
    assert.equal(result.artifacts.length, 5);
    assert.equal(result.artifacts.find((row) => row.path === viewed).source, "tool");
    assert.equal(result.artifacts.find((row) => row.path === viewed).eventId, "view-event");
    assert.equal(result.artifacts.find((row) => row.path === upload).source, "uploaded");
    assert.equal(result.artifacts.find((row) => row.path === generated).source, "generated");
    assert.equal(result.artifacts.filter((row) => row.path === report).length, 1);
    const missing = result.artifacts.find((row) => row.name === "removed.pdf");
    assert.equal(missing.availability, "missing");
    assert.ok(missing.reason);
    await assert.rejects(catalog.read(missing.id), { code: "artifact_unavailable" });
    assert.ok(result.warnings.some((warning) => /incomplete/.test(warning)));
});

test("retained image bytes recover missing captures, and SVG and Office files remain binary downloads", async (t) => {
    const { home, open, events, file } = await fixture(t);
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    const assetId = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const removed = join(home, "removed.png");
    await events("current", [
        { type: "session.start", data: { context: { cwd: home } } },
        { type: "tool.execution_start", data: { toolCallId: "shot", toolName: "playwright-browser_take_screenshot", arguments: { filename: removed } } },
        { type: "tool.execution_complete", data: { toolCallId: "shot", success: true, result: { content: `[Screenshot](${removed})` } } },
        { type: "session.binary_asset", data: { assetId, type: "image", mimeType: "image/png", byteLength: bytes.length, data: bytes.toString("base64") } },
        { type: "tool.execution_start", data: { toolCallId: "view", toolName: "view", arguments: { path: removed } } },
        { type: "tool.execution_complete", data: { toolCallId: "view", success: true, result: { binaryResultsForLlm: [{ type: "image", assetId, mimeType: "image/png" }] } } },
    ]);
    await file("current", "diagram.svg", "<svg><script>alert(1)</script></svg>");
    await file("current", "slides.pptx", Buffer.from("office bytes"));
    await file("current", "photo.png", bytes);
    const catalog = open();
    const result = await catalog.artifacts("current");
    assert.equal(result.artifacts.length, 4);
    const image = result.artifacts.find((row) => row.path === removed);
    assert.equal(image.availability, "available");
    assert.equal(image.source, "generated");
    assert.equal(image.kind, "image");
    assert.deepEqual((await catalog.read(image.id)).bytes, bytes);
    for (const row of result.artifacts) {
        const read = await catalog.read(row.id);
        assert.equal(read.content, null);
        assert.ok(Buffer.isBuffer(read.bytes));
        assert.equal(Object.hasOwn(row, "retainedAsset"), false);
    }
    const history = join(home, "session-state", "current", "events.jsonl");
    await writeFile(history, (await readFile(history, "utf8")).replace(assetId, `sha256:${"0".repeat(64)}`));
    await assert.rejects(catalog.read(image.id), /retained/);
});

test("approved trees reject symlink escapes, secrets and network paths while bounded nested files are readable", async (t) => {
    const { home, open, events, file } = await fixture(t);
    await file("current", "readme.md", "Safe");
    const root = join(home, "session-state", "current", "files");
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "data.json"), '{"ok":true}');
    await writeFile(join(root, ".env"), "PRIVATE");
    await mkdir(join(root, "credentials"));
    await writeFile(join(root, "credentials", "private.json"), "PRIVATE");
    await mkdir(join(root, ".github"));
    await writeFile(join(root, ".github", "instructions.md"), "Hidden metadata");
    const outside = join(home, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "escape.md"), "Outside");
    await symlink(outside, join(root, "escaped"), "junction");
    await events("current", [{ type: "user.message", data: { attachments: [
        { type: "file", path: join(root, "escaped", "escape.md") },
        { type: "file", path: join(root, "credentials", "private.json") },
        { type: "file", path: join(root, ".github", "instructions.md") },
        { type: "file", path: "https://example.com/secret.md" },
        { type: "file", path: "\\\\server\\secret.md" },
    ] } }]);
    const catalog = open();
    const result = await catalog.artifacts("current");
    assert.ok(result.artifacts.some((row) => row.name === "data.json"));
    assert.ok(!result.artifacts.some((row) => row.name === "private.json"));
    assert.ok(!result.artifacts.some((row) => row.name === "instructions.md"));
    assert.ok(!result.warnings.some((warning) => /sensitive artifact reference/i.test(warning)));
    const escaped = result.artifacts.find((row) => row.name === "escape.md");
    assert.equal(escaped.availability, "unavailable");
    await assert.rejects(catalog.read(escaped.id), { code: "artifact_unavailable" });
    assert.ok(result.warnings.some((warning) => /symlink|symbolic|outside|unsafe/i.test(warning)));
    const safe = result.artifacts.find((row) => row.name === "readme.md");
    await writeFile(safe.path, "Changed");
    await assert.rejects(catalog.read(safe.id), { code: "artifact_changed" });
    await assert.rejects(catalog.read(safe.path), { code: "artifact_missing" });
    await assert.rejects(catalog.read(safe.id, { version: 1 }), { code: "version_unavailable" });
    assert.deepEqual(catalog.revisions(safe.id), []);
});

test("images and event journals cannot bypass approved directory boundaries", async (t) => {
    const { home, open, events, file } = await fixture(t);
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    await file("current", "local.md", "Local");
    const outside = join(home, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "private.png"), bytes);
    const root = join(home, "session-state", "current", "files");
    await symlink(outside, join(root, "escaped"), "junction");
    await events("current", [{ type: "user.message", data: { attachments: [
        { type: "file", path: join(root, "escaped", "private.png") },
    ] } }]);
    const catalog = open();
    const image = (await catalog.artifacts("current")).artifacts.find((row) => row.kind === "image");
    assert.equal(image.availability, "unavailable");
    await assert.rejects(catalog.read(image.id), { code: "artifact_unavailable" });
    await writeFile(join(outside, "events.jsonl"), JSON.stringify({ type: "user.message", data: { attachments: [
        { type: "file", path: join(outside, "private.png") },
    ] } }) + "\n");
    await symlink(outside, join(home, "session-state", "previous"), "junction");
    const refreshed = await catalog.artifacts("current");
    assert.ok(!refreshed.artifacts.some((row) => row.path === join(outside, "private.png")));
    assert.ok(refreshed.warnings.some((warning) => /history.*(?:unsafe|symbolic|outside)/i.test(warning)));
});

test("pins persist for discovered and published IDs without modifying host metadata or originals", async (t) => {
    const { home, open, file } = await fixture(t);
    const path = await file("current", "pinned.md", "Original");
    const originalDb = await readFile(join(home, "data.db"));
    const first = open();
    const item = (await first.artifacts("current")).artifacts[0];
    const note = await first.publish({ sessionId: "previous", title: "Pinned note", content: "Keep" });
    assert.throws(() => first.pin(item.id, "yes"), { code: "invalid_input" });
    assert.throws(() => first.pin("f".repeat(64), true), { code: "artifact_missing" });
    assert.equal(first.pin(item.id, true).pinned, true);
    assert.equal(first.pin(note.id, true).pinned, true);
    first.close();
    const second = open();
    const result = await second.artifacts("workspace");
    assert.equal(result.artifacts.length, 2);
    assert.ok(result.artifacts.every((row) => row.pinned));
    assert.equal((await second.read(note.id, { version: 1 })).metadata.pinned, true);
    assert.equal(second.pin(item.id, false).pinned, false);
    assert.equal((await second.artifacts("current")).artifacts.find((row) => row.id === item.id).pinned, false);
    assert.deepEqual(await readFile(join(home, "data.db")), originalDb);
    assert.equal(await readFile(path, "utf8"), "Original");
});

test("file, journal, depth and directory-entry limits report partial discovery explicitly", async (t) => {
    const { home, open, events, file } = await fixture(t);
    const text = await file("current", "large.md", "");
    await truncate(text, 1024 * 1024 + 1);
    const binary = await file("current", "large.pdf", "");
    await truncate(binary, 32 * 1024 * 1024 + 1);
    await events("current", []);
    await truncate(join(home, "session-state", "current", "events.jsonl"), 64 * 1024 * 1024 + 2);
    const root = join(home, "session-state", "current", "files");
    const deep = join(root, "one", "two", "three", "four", "five");
    await mkdir(deep, { recursive: true });
    await writeFile(join(deep, "too-deep.md"), "Skipped");
    const catalog = open();
    let result = await catalog.artifacts("current");
    assert.equal(result.artifacts.length, 2);
    assert.ok(result.artifacts.every((row) => row.availability === "unavailable"));
    assert.ok(result.warnings.some((warning) => /64 MiB/.test(warning)));
    assert.ok(result.warnings.some((warning) => /depth-4/.test(warning)));
    assert.ok(result.warnings.some((warning) => /read limit/.test(warning)));
    const many = join(root, "many");
    await mkdir(many);
    for (let start = 0; start < 5001; start += 100) {
        await Promise.all(Array.from({ length: Math.min(100, 5001 - start) },
            (_, index) => writeFile(join(many, `${start + index}.bin`), "")));
    }
    result = await catalog.artifacts("current");
    assert.ok(result.warnings.some((warning) => /5,000.*entr/.test(warning)));
});

test("malformed host schemas surface actionable warnings and stale catalogs cannot remain readable", async (t) => {
    const { home, open, file } = await fixture(t);
    await file("current", "brief.md", "Valid before removal");
    const catalog = open();
    const item = (await catalog.artifacts("current")).artifacts[0];
    const db = new DatabaseSync(join(home, "data.db"));
    db.exec("DROP TABLE sessions; CREATE TABLE sessions (unexpected TEXT)");
    db.close();
    const result = catalog.sessions("current");
    assert.deepEqual(result.sessions, []);
    assert.equal(result.defaultSessionId, null);
    assert.ok(result.warnings.some((warning) => /schema|required.*sessions/i.test(warning)));
    await assert.rejects(catalog.artifacts("current"), { code: "unsupported_schema" });
    await assert.rejects(catalog.read(item.id), { code: "artifact_missing" });
});

test("concurrent scope refreshes never mix independent sessions' artifact responses", async (t) => {
    const { home, open, file } = await fixture(t);
    const db = new DatabaseSync(join(home, "data.db"));
    db.exec("INSERT INTO sessions VALUES ('other', 'Other', NULL, NULL, 'local')");
    db.close();
    await file("current", "current.md", "Current");
    await file("other", "other.md", "Other");
    const catalog = open();
    const [current, other] = await Promise.all([catalog.artifacts("current"), catalog.artifacts("other")]);
    assert.deepEqual(current.artifacts.map((row) => row.sessionId), ["current"]);
    assert.deepEqual(other.artifacts.map((row) => row.sessionId), ["other"]);
});

test("metadata contracts include explicit reasons and scope byte limits without exposing private read handles", async (t) => {
    const { open, file } = await fixture(t);
    for (let index = 0; index < 5; index++) {
        const path = await file("current", `large-${index}.pdf`, "");
        await truncate(path, 32 * 1024 * 1024);
    }
    const catalog = open();
    const result = await catalog.artifacts("current");
    assert.equal(result.artifacts.filter((row) => row.availability === "available").length, 4);
    assert.ok(result.warnings.some((warning) => /128 MiB/.test(warning)));
    const expected = ["id", "sessionId", "sessionName", "title", "name", "kind", "source", "path",
        "timestamp", "timestampBasis", "size", "mime", "availability", "reason", "version", "pinned", "tool", "eventId"];
    for (const item of result.artifacts) {
        for (const key of expected) assert.ok(Object.hasOwn(item, key), `Missing ${key}`);
        assert.ok(!Object.hasOwn(item, "fingerprint"));
        assert.ok(!Object.hasOwn(item, "realPath"));
    }
    await assert.rejects(catalog.read(result.artifacts[0].id, null), { code: "invalid_input" });
    await assert.rejects(catalog.artifacts("current", null), { code: "invalid_input" });
});

test("large descendant catalogs stop at the scope record cap with an explicit partial-result warning", async (t) => {
    const { home, open, events } = await fixture(t);
    const db = new DatabaseSync(join(home, "data.db"));
    db.exec(`
        INSERT INTO sessions VALUES ('child-one', 'One', NULL, NULL, 'local'), ('child-two', 'Two', NULL, NULL, 'local');
        CREATE TABLE session_side_chats (session_id TEXT, parent_session_id TEXT);
        INSERT INTO session_side_chats VALUES ('child-one', 'workspace'), ('child-two', 'workspace');
    `);
    db.close();
    for (const [session, count] of [["current", 5000], ["child-one", 5000], ["child-two", 1]]) {
        await events(session, [{ type: "user.message", data: { attachments: Array.from({ length: count },
            (_, index) => ({ type: "file", path: join(home, `${session}-${index}.md`) })) } }]);
    }
    const result = await open().artifacts("current", { includeChildren: true });
    assert.equal(result.artifacts.length, 10000);
    assert.ok(result.warnings.some((warning) => /10,000.*artifact/.test(warning)));
});

test("removed files fail with a refreshable catalog error rather than reading an alternate path", async (t) => {
    const { open, file } = await fixture(t);
    const path = await file("current", "gone.txt", "Captured at discovery");
    const catalog = open();
    const item = (await catalog.artifacts("current")).artifacts[0];
    await rm(path);
    await assert.rejects(catalog.read(item.id), { code: "artifact_changed" });
    const refreshed = await catalog.artifacts("current");
    assert.equal(refreshed.artifacts.length, 0);
    assert.throws(() => catalog.metadata(item.id), { code: "artifact_missing" });
});

test("malformed structured tool records do not hide later valid attachments", async (t) => {
    const { home, open, events } = await fixture(t);
    const path = join(home, "attachment.md");
    await writeFile(path, "Retained output");
    await events("current", [
        { type: "session.start", data: { context: { cwd: 123 } } },
        { type: "tool.execution_start", data: { toolCallId: "bad", toolName: 123, arguments: {} } },
        { type: "tool.execution_complete", data: { toolCallId: "bad", success: true } },
        { type: "user.message", data: { attachments: [{ type: "file", path }] } },
    ]);
    const result = await open().artifacts("current");
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0].name, "attachment.md");
    assert.ok(result.warnings.some((warning) => /malformed/.test(warning)));
});

test("publications follow workspace identity rotation without losing versions or weakening ownership", async (t) => {
    const { home, open } = await fixture(t);
    const first = open();
    const note = await first.publish({ sessionId: "previous", title: "Persistent", content: "Version one" });
    first.close();
    const db = new DatabaseSync(join(home, "data.db"));
    db.exec(`
        INSERT INTO sessions VALUES ('resumed', 'Resumed', NULL, NULL, 'local'), ('stranger', 'Stranger', NULL, NULL, 'local');
        INSERT INTO workspace_session_aliases VALUES ('current', 'workspace');
        UPDATE workspaces SET session_id = 'resumed' WHERE id = 'workspace';
    `);
    db.close();
    const second = open();
    const result = await second.artifacts("workspace");
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0].sessionId, "resumed");
    const updated = await second.publish({ sessionId: "current", id: note.id, expectedVersion: 1, title: "Updated", content: "Version two" });
    assert.equal(updated.sessionId, "resumed");
    assert.equal((await second.read(note.id, { version: 1 })).content, "Version one");
    assert.equal(second.metadata(note.id).sessionId, "resumed");
    await assert.rejects(second.publish({ sessionId: "stranger", id: note.id, expectedVersion: 2, title: "No", content: "No" }), { code: "version_conflict" });
});

test("append-only live journal growth preserves immutable retained-image reads", async (t) => {
    const { home, open, events } = await fixture(t);
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    const assetId = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    await events("current", [
        { type: "session.binary_asset", data: { assetId, type: "image", mimeType: "image/png", byteLength: bytes.length, data: bytes.toString("base64") } },
        { type: "user.message", data: { attachments: [{ type: "blob", mimeType: "image/png", assetId }] } },
    ]);
    const catalog = open();
    const image = (await catalog.artifacts("current")).artifacts[0];
    await appendFile(join(home, "session-state", "current", "events.jsonl"),
        JSON.stringify({ type: "assistant.message", data: { content: "Continued work" } }) + "\n");
    assert.deepEqual((await catalog.read(image.id)).bytes, bytes);
});

test("metadata-only changes preserve reads while same-size edits with restored mtime remain rejected", async (t) => {
    const { open, file } = await fixture(t);
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
    const timestamp = new Date("2026-10-20T00:00:00.000Z");
    const paths = [
        await file("current", "document.md", "Same"),
        await file("current", "slides.pptx", "office bytes"),
        await file("current", "photo.png", bytes),
    ];
    for (const path of paths) await utimes(path, timestamp, timestamp);
    const catalog = open();
    const records = (await catalog.artifacts("current")).artifacts;
    for (const item of records) {
        const before = await stat(item.path, { bigint: true });
        const original = await readFile(item.path);
        try {
            await chmod(item.path, 0o444);
            const after = await stat(item.path, { bigint: true });
            assert.equal(after.mtimeNs, before.mtimeNs);
            assert.equal(after.size, before.size);
            assert.notEqual(after.ctimeNs, before.ctimeNs);
            const result = await catalog.read(item.id);
            assert.deepEqual(result.bytes ?? Buffer.from(result.content), original);
        } finally { await chmod(item.path, 0o666); }
        const modified = Buffer.from(original);
        modified[modified.length - 1] ^= 1;
        await writeFile(item.path, modified);
        await utimes(item.path, timestamp, timestamp);
        const changed = await stat(item.path, { bigint: true });
        assert.equal(changed.mtimeNs, before.mtimeNs);
        assert.equal(changed.size, before.size);
        await assert.rejects(catalog.read(item.id), { code: "artifact_changed" });
    }
});
