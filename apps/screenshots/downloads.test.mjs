import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./server.mjs";
import { downloadArchive, downloadName, revealCommand, revealDownload } from "./downloads.mjs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

test("individual and ZIP downloads export indexed bytes with safe unique names", async (t) => {
    const ids = ["a".repeat(64), "b".repeat(64)];
    const bytes = Buffer.from("image bytes");
    const catalog = {
        metadata: (id) => {
            if (!ids.includes(id)) throw Object.assign(new Error("Not indexed"), { code: "image_missing" });
            return { id, name: "..\\same.png", size: bytes.length, availability: "available" };
        },
        openImage: async (id) => {
            catalog.metadata(id);
            return { data: bytes, size: bytes.length, mime: "image/png" };
        },
    };
    const server = await startServer(catalog);
    t.after(() => server.close());
    const single = await fetch(new URL(`download/${ids[0]}`, server.url));
    assert.equal(single.status, 200);
    assert.match(single.headers.get("content-disposition"), /^attachment; filename="same.png"/);
    assert.deepEqual(Buffer.from(await single.arrayBuffer()), bytes);
    const archive = await fetch(new URL("api/download-all", server.url), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }),
    });
    assert.equal(archive.status, 200);
    assert.equal(archive.headers.get("content-type"), "application/zip");
    const zip = Buffer.from(await archive.arrayBuffer());
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.ok(zip.includes(Buffer.from("0001-same.png")));
    assert.ok(zip.includes(Buffer.from("0002-same.png")));
    assert.ok(zip.includes(bytes));
    assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
    assert.equal(zip.readUInt16LE(zip.length - 12), 2);
    const invalid = await fetch(new URL("api/download-all", server.url), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ["../secret"] }),
    });
    assert.equal(invalid.status, 400);
    const foreign = await fetch(new URL("api/download-all", server.url), {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "https://example.com" }, body: JSON.stringify({ ids }),
    });
    assert.equal(foreign.status, 403);
});

test("bulk exports reject missing images, duplicate selections, and oversized archives before reading bytes", async () => {
    const id = "a".repeat(64);
    let opened = false;
    const catalog = {
        metadata: () => ({ id, name: "capture.png", availability: "available", size: 32 * 1024 * 1024 }),
        openImage: async () => { opened = true; throw new Error("Unexpected read"); },
    };
    await assert.rejects(downloadArchive(catalog, []), /unique indexed/);
    await assert.rejects(downloadArchive(catalog, [id, id]), /unique indexed/);
    await assert.rejects(downloadArchive(catalog, Array.from({ length: 5 }, (_, index) => String(index).repeat(64))), /128 MiB/);
    assert.equal(opened, false);
    catalog.metadata = () => ({ id, availability: "missing" });
    await assert.rejects(downloadArchive(catalog, [id]), /unavailable/);
    assert.equal(downloadName("CON.png"), "_CON.png");
    assert.equal(downloadName("../../hello\r\n.png"), "hello__.png");
});

test("download clicks save verified files and exactly one ZIP without overwriting earlier downloads", async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "screenshots-download-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const ids = ["a".repeat(64), "b".repeat(64)];
    const bytes = Buffer.from("known screenshot bytes");
    const catalog = {
        metadata: (id) => {
            if (!ids.includes(id)) throw Object.assign(new Error("Image not indexed"), { code: "image_missing" });
            return { id, name: "capture.png", size: bytes.length, availability: "available" };
        },
        openImage: async (id) => {
            catalog.metadata(id);
            return { data: bytes, size: bytes.length, mime: "image/png" };
        },
    };
    const server = await startServer(catalog, { downloadDirectory: directory });
    t.after(() => server.close());
    async function save(input) {
        const response = await fetch(new URL("api/save-download", server.url), {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
        });
        assert.equal(response.status, 200);
        return response.json();
    }
    const single = await save({ ids: [ids[0]], archive: false });
    assert.equal(single.path, join(directory, "capture.png"));
    assert.equal(createHash("sha256").update(await readFile(single.path)).digest("hex"), createHash("sha256").update(bytes).digest("hex"));
    const second = await save({ ids: [ids[0]], archive: false });
    assert.notEqual(second.path, single.path);
    const archive = await save({ ids, archive: true });
    const zip = await readFile(archive.path);
    assert.equal(archive.count, 2);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.equal(zip.readUInt16LE(zip.length - 12), 2);
    assert.deepEqual((await readdir(directory)).sort(), ["capture (1).png", "capture.png", "screenshots.zip"]);
    const foreign = await fetch(new URL("api/save-download", server.url), {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "https://example.com" },
        body: JSON.stringify({ ids: [ids[0]], archive: false }),
    });
    assert.equal(foreign.status, 403);
    const arbitraryPath = await fetch(new URL("api/save-download", server.url), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [ids[0]], archive: false, path: "../elsewhere" }),
    });
    assert.equal(arbitraryPath.status, 400);
    assert.deepEqual((await readdir(directory)).sort(), ["capture (1).png", "capture.png", "screenshots.zip"]);
});

test("Open in folder only reveals files actually saved by this server, never caller-supplied paths", async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "screenshots-reveal-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const id = "a".repeat(64);
    const bytes = Buffer.from("image bytes");
    const revealed = [];
    const server = await startServer({
        metadata: () => ({ id, name: "capture.png", availability: "available", size: bytes.length }),
        openImage: async () => ({ data: bytes, size: bytes.length, mime: "image/png" }),
    }, { downloadDirectory: directory, revealFile: async (path) => { revealed.push(path); return { selected: true }; } });
    t.after(() => server.close());
    const post = (route, input, extra = {}) => fetch(new URL(route, server.url), {
        method: "POST", headers: { "content-type": "application/json", ...extra }, body: JSON.stringify(input),
    });
    const saved = await (await post("api/save-download", { ids: [id], archive: false })).json();
    assert.match(saved.downloadId ?? "", /^[a-f0-9]{32}$/);
    const response = await post("api/open-download-folder", { downloadId: saved.downloadId });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).selected, true);
    assert.deepEqual(revealed, [saved.path]);
    assert.equal((await post("api/open-download-folder", { downloadId: "0".repeat(32) })).status, 404);
    assert.equal((await post("api/open-download-folder", { path: "C:\\private" })).status, 400);
    assert.equal((await post("api/open-download-folder", { downloadId: saved.downloadId }, { Origin: "https://example.com" })).status, 403);
    assert.equal(revealed.length, 1);
});

test("Windows folder reveal keeps the selection switch and spaced path in one argument", () => {
    const path = "C:\\Users\\Example User\\Downloads\\screenshots (2).zip";
    const command = revealCommand(path, "win32", { WINDIR: "C:\\Windows" });
    assert.deepEqual(command.args, [`/select,${path}`]);
    assert.equal(command.selected, true);
});

test("moved downloads fail explicitly before attempting to open a file manager", async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "screenshots-moved-download-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await assert.rejects(revealDownload(join(directory, "moved.png")), /moved or deleted/);
});
