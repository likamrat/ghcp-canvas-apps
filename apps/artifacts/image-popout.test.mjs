import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./server.mjs";
import { imageWindowCommand } from "./image-window.mjs";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const id = "a".repeat(64);
const image = {
    metadata: { id, kind: "image", availability: "available", name: 'Image "one".png' },
    bytes: Buffer.from("image"), content: null, filename: 'Image "one".png', mime: "image/png",
};
const post = (server, input = { id }, headers = {}) => fetch(new URL("api/open-image", server.url), {
    method: "POST", headers: { "content-type": "application/json", "x-canvas-popout": "1", ...headers },
    body: JSON.stringify(input),
});

test("image clicks launch a separate image-only window from canvas and browser views", async t => {
    const launches = [];
    const server = await startServer({ read: async value => {
        assert.equal(value, id);
        return image;
    } }, { launchImage: async url => { launches.push(url); } });
    t.after(() => server.close());
    assert.equal(server.hasBrowserWindow(), false);
    for (const referer of [server.url, `${server.url}?view=browser`]) {
        const response = await post(server, { id }, { Referer: referer });
        assert.equal(response.status, 200);
        const url = new URL(launches.at(-1));
        assert.equal(url.origin, new URL(server.url).origin);
        assert.equal(url.searchParams.get("id"), id);
        const preview = await fetch(url);
        assert.equal(preview.status, 200);
        const html = await preview.text();
        assert.match(html, /image-preview\.js/);
        assert.doesNotMatch(html, /app\.js|Filters and refresh|Image zoom/);
    }
    assert.equal(launches.length, 2);
    assert.equal(server.hasBrowserWindow(), true, "Closing the canvas must not stop an image window");
});

test("image launch accepts only indexed readable images and explicit same-origin requests", async t => {
    let result = image, launches = 0;
    const server = await startServer({ read: async () => result }, { launchImage: async () => { launches++; } });
    t.after(() => server.close());
    assert.equal((await post(server, { id }, { Origin: "https://example.com" })).status, 403);
    assert.equal((await post(server, { id }, { "x-canvas-popout": "" })).status, 403);
    for (const input of [{ id: "bad" }, { id, path: "C:\\private.png" }, { id, url: "https://example.com" }]) {
        assert.equal((await post(server, input)).status, 400);
    }
    result = { ...image, metadata: { ...image.metadata, kind: "document" }, mime: "text/html" };
    assert.equal((await post(server)).status, 400);
    result = { ...image, metadata: { ...image.metadata, availability: "missing" } };
    assert.equal((await post(server)).status, 400);
    assert.equal(launches, 0);
    assert.equal(server.hasBrowserWindow(), false);
});

test("image launches suppress concurrent clicks, retain pending windows, and recover from failures", async t => {
    let fail = true, release, started;
    const pending = new Promise(resolve => { release = resolve; });
    const entered = new Promise(resolve => { started = resolve; });
    const server = await startServer({ read: async () => image }, { launchImage: async () => {
        started();
        await pending;
        if (fail) throw new Error("Image window could not open");
    } });
    t.after(() => server.close());
    const first = post(server);
    await entered;
    assert.equal(server.hasBrowserWindow(), true);
    const second = await post(server);
    assert.equal(second.status, 503);
    release();
    assert.equal((await first).status, 503);
    assert.equal(server.hasBrowserWindow(), false);
    fail = false;
    assert.equal((await post(server)).status, 200);
    assert.equal(server.hasBrowserWindow(), true);
});

test("image-only launch commands use an installed browser without profiles or shell interpolation", () => {
    const url = `http://127.0.0.1:12345/local/image-preview?id=${id}`;
    const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
    const command = imageWindowCommand(url, { platform: "win32",
        env: { "ProgramFiles(x86)": "C:\\Program Files (x86)" }, exists: path => path === edge });
    assert.equal(command.executable, edge);
    assert.deepEqual(command.args, [`--app=${url}`, "--window-size=1100,800"]);
    for (const bad of ["https://example.com", "file:///private", "http://localhost:12345/", "http://user:pass@127.0.0.1:12345/"]) {
        assert.throws(() => imageWindowCommand(bad), /local artifact/);
    }
    assert.throws(() => imageWindowCommand(url, { exists: () => false }), /requires Microsoft Edge/);
    assert.equal(imageWindowCommand(url, { platform: "linux", exists: path => path === "/usr/bin/chromium" }).executable, "/usr/bin/chromium");
    const mac = imageWindowCommand(url, { platform: "darwin", exists: path => path === "/Applications/Google Chrome.app" });
    assert.deepEqual(mac, { executable: "/usr/bin/open", args: ["-a", "/Applications/Google Chrome.app", "--args", `--app=${url}`, "--window-size=1100,800"] });
});

test("missing or changed images fail before a separate window is opened", async t => {
    let launches = 0;
    const server = await startServer({ read: async () => {
        throw Object.assign(new Error("Artifact changed; refresh first."), { code: "artifact_changed" });
    } }, { launchImage: async () => { launches++; } });
    t.after(() => server.close());
    const response = await post(server);
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /refresh first/);
    assert.equal(launches, 0);
    assert.equal(server.hasBrowserWindow(), false);
});

test("image click state preserves selection and reports launch failures without duplicate requests", async () => {
    const source = await readFile(new URL("app.js", import.meta.url), "utf8");
    const start = source.indexOf("async function openImageWindow("), end = source.indexOf("function downloadNotice(");
    assert.ok(start >= 0 && end > start);
    const status = { isConnected: true, setAttribute() {} }, attributes = new Map(), calls = [];
    const image = { setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key) };
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const context = {
        $: key => key === "preview-image" ? image : status,
        document: { querySelectorAll: () => [image] },
        api: async (...args) => { calls.push(args); await pending; },
        setError: message => { status.textContent = message; },
    };
    const open = runInNewContext(`let openingImage = false;\n${source.slice(start, end)}\nopenImageWindow`, context);
    const first = open({ id });
    await open({ id: "b".repeat(64) });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "api/open-image");
    assert.equal(calls[0][1].id, id);
    assert.equal(calls[0][2]["x-canvas-popout"], "1");
    assert.equal(attributes.get("aria-disabled"), "true");
    release();
    await first;
    assert.equal(status.hidden, true);
    assert.equal(attributes.has("aria-disabled"), false);
    context.api = async () => { throw new Error("Browser not available"); };
    await open({ id });
    assert.equal(status.textContent, "Browser not available");
    assert.equal(status.hidden, false);
    assert.equal(attributes.has("aria-disabled"), false);
});
