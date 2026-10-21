import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startServer as startMonitor } from "../apps/context-monitor/server.mjs";
import { startServer as startScreenshots } from "../apps/screenshots/server.mjs";
import { startServer as startArtifacts } from "../apps/artifacts/server.mjs";
import { querySchema } from "../apps/screenshots/model.mjs";

test("standalone filter controls are identical and all filter apps serve every required asset", async (t) => {
    const servers = [
        await startMonitor(() => ({ sessions: [] })),
        await startScreenshots({ sessions: () => ({ sessions: [] }) }),
        await startArtifacts({}),
    ];
    t.after(() => Promise.all(servers.map((server) => server.close())));
    for (const file of ["multiselect.js", "multiselect.css"]) {
        const monitor = await readFile(new URL(`../apps/context-monitor/${file}`, import.meta.url), "utf8");
        assert.equal(await readFile(new URL(`../apps/screenshots/${file}`, import.meta.url), "utf8"), monitor);
        assert.equal(await readFile(new URL(`../apps/artifacts/${file}`, import.meta.url), "utf8"), monitor);
        for (const server of servers) {
            const response = await fetch(new URL(file, server.url));
            assert.equal(response.status, 200);
            assert.match(response.headers.get("content-type"), file.endsWith(".js") ? /javascript/ : /css/);
            assert.equal(await response.text(), monitor);
        }
    }
    const monitorHtml = await (await fetch(servers[0].url)).text();
    const screenshotsHtml = await (await fetch(servers[1].url)).text();
    const artifactsHtml = await (await fetch(servers[2].url)).text();
    for (const [html, ids] of [[monitorHtml, ["model-filter", "usage-filter"]], [screenshotsHtml, ["source"]], [artifactsHtml, ["kinds", "sources"]]]) {
        for (const id of ids) assert.match(html, new RegExp(`<select id="${id}"[^>]*multiple[^>]*data-multiselect=`));
        assert.match(html, /<script src="[^"]*multiselect\.js" defer><\/script>/);
        assert.match(html, /<link rel="stylesheet" href="[^"]*multiselect\.css">/);
        assert.doesNotMatch(html, /<select id="(?:sort-by|sort|page-size|auto-refresh)"[^>]*multiple/);
    }
});

test("Screenshots canvas action accepts multiple sources while preserving scalar callers", () => {
    const [scalar, multiple] = querySchema.properties.source.anyOf;
    assert.ok(scalar.enum.includes("generated"));
    assert.equal(multiple.type, "array");
    assert.equal(multiple.uniqueItems, true);
    assert.deepEqual(multiple.items.enum, ["uploaded", "generated", "tool", "unknown"]);
});
