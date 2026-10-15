import test from "node:test";
import assert from "node:assert/strict";
import { startServer as screenshots } from "../apps/screenshots/server.mjs";
import { startServer as monitor } from "../apps/context-monitor/server.mjs";
import { startServer as thoughts } from "../apps/thoughts/server.mjs";
import { browserCommand } from "../apps/screenshots/browser.mjs";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
const apps = new URL("../apps/", import.meta.url);

test("every app exposes an authenticated browser pop-out and retains its server after launch", async (t) => {
    const launches = [];
    const launchBrowser = async (url) => { launches.push(url); return { mode: "window", browser: "Test browser" }; };
    const servers = [
        await screenshots({}, { launchBrowser }),
        await monitor(() => ({}), undefined, { launchBrowser }),
        await thoughts({}, { launchBrowser }),
    ];
    t.after(() => Promise.all(servers.map((server) => server.close())));
    for (const server of servers) {
        assert.equal(server.hasBrowserWindow(), false);
        const html = await (await fetch(server.url)).text();
        const token = html.match(/name="(?:monitor|inbox)-token" content="([^"]+)"/)?.[1];
        const headers = { "content-type": "application/json", "x-canvas-popout": "1" };
        if (token) headers[html.includes("monitor-token") ? "x-monitor-token" : "x-inbox-token"] = token;
        const endpoint = new URL("api/open-browser", server.url);
        const forbidden = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        assert.equal(forbidden.status, 403);
        const result = await fetch(endpoint, { method: "POST", headers, body: "{}" });
        assert.equal(result.status, 200);
        assert.equal((await result.json()).mode, "window");
        assert.equal(server.hasBrowserWindow(), true);
        assert.equal((await fetch(server.url)).status, 200);
        const foreign = await fetch(endpoint, { method: "POST", headers: { ...headers, Origin: "https://example.com" }, body: "{}" });
        assert.equal(foreign.status, 403);
        const invalid = await fetch(endpoint, { method: "POST", headers, body: '{"url":"https://example.com"}' });
        assert.equal(invalid.status, 400);
    }
    assert.equal(launches.length, 3);
    assert.ok(launches.every((url) => new URL(url).hostname === "127.0.0.1" && new URL(url).searchParams.get("view") === "browser"));
});

test("browser commands request dedicated local app windows without accepting remote or executable URLs", () => {
    const command = browserCommand("http://127.0.0.1:12345/local/?session=example&view=browser", {
        platform: "win32", env: { "ProgramFiles(x86)": "C:\\Program Files (x86)" }, exists: () => true,
    });
    assert.equal(command.mode, "window");
    assert.equal(command.browser, "Microsoft Edge");
    assert.deepEqual(command.args, ["--app=http://127.0.0.1:12345/local/?session=example&view=browser", "--new-window"]);
    for (const url of ["https://example.com", "file:///secret", "http://localhost:12345", "http://user:password@127.0.0.1:12345"]) {
        assert.throws(() => browserCommand(url), /local browser/);
    }
    const fallback = browserCommand("http://127.0.0.1:12345/", { platform: "linux", env: {}, exists: (file) => file === "/usr/bin/xdg-open" });
    assert.equal(fallback.mode, "browser");
    assert.throws(() => browserCommand("http://127.0.0.1:12345/", { exists: () => false }), /launcher/);
});

test("browser launch failures stay visible and do not retain the server", async (t) => {
    const server = await screenshots({}, { launchBrowser: async () => { throw new Error("Synthetic browser launch failed"); } });
    t.after(() => server.close());
    const response = await fetch(new URL("api/open-browser", server.url), {
        method: "POST", headers: { "content-type": "application/json", "x-canvas-popout": "1" },
        body: '{"sessionId":"selected-session"}',
    });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /Synthetic browser launch failed/);
    assert.equal(server.hasBrowserWindow(), false);
});

test("standalone apps carry identical browser helpers and header controls", async () => {
    for (const filename of ["browser.mjs", "browser.js"]) {
        const canonical = await readFile(new URL(`screenshots/${filename}`, apps), "utf8");
        for (const app of ["context-monitor", "thoughts"]) {
            assert.equal(await readFile(new URL(`${app}/${filename}`, apps), "utf8"), canonical);
        }
    }
    for (const app of ["screenshots", "context-monitor", "thoughts"]) {
        const html = await readFile(new URL(`${app}/index.html`, apps), "utf8");
        assert.match(html, /id="open-browser"/);
        assert.match(html, /id="browser-status"/);
    }
});

test("each extension closes ordinary canvases but keeps explicit browser views alive and reuses them", async () => {
    for (const app of ["screenshots", "context-monitor", "thoughts"]) {
        const source = (await readFile(new URL(`${app}/extension.mjs`, apps), "utf8")).replace(/^import .*;\r?\n/gm, "");
        let declaration, started = 0, closed = 0, poppedOut = false;
        const fakeServer = { url: "http://127.0.0.1:12345/", hasBrowserWindow: () => poppedOut, close: async () => { closed++; } };
        const context = {
            joinSession: async (options) => { declaration = options.canvases[0]; return {}; },
            createCanvas: (options) => ({ ...options, declaration: {} }), CanvasError: Error,
            createCatalog: () => ({}), querySchema: {}, queryImages: () => ({}),
            createSettings: () => ({}), settingsSchema: {}, readSnapshot: () => ({}),
            createStore: () => ({}), actionSchemas: {},
            startServer: async () => { started++; return fakeServer; },
        };
        await runInNewContext(`(async () => { ${source}\n })()`, context);
        await declaration.open({ instanceId: "ordinary", input: {} });
        await declaration.onClose({ instanceId: "ordinary" });
        assert.equal(closed, 1, `${app}: ordinary close must release the server`);
        await declaration.open({ instanceId: "browser", input: {} });
        poppedOut = true;
        await declaration.onClose({ instanceId: "browser" });
        assert.equal(closed, 1, `${app}: browser view was stopped by canvas close`);
        await declaration.open({ instanceId: "browser", input: {} });
        assert.equal(started, 2, `${app}: re-open should reuse the retained server`);
    }
});
