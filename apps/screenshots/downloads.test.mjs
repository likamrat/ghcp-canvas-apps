import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./server.mjs";
import { downloadArchive, downloadName } from "./downloads.mjs";

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
