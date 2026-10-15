import test from "node:test";
import assert from "node:assert/strict";
import { startServer as screenshots } from "../apps/screenshots/server.mjs";
import { startServer as monitor } from "../apps/context-monitor/server.mjs";
import { startServer as thoughts } from "../apps/thoughts/server.mjs";

test("all apps declare and serve bundled favicons in standalone browser views", async (t) => {
    const servers = [await screenshots({}), await monitor(() => ({})), await thoughts({})];
    t.after(() => Promise.all(servers.map((server) => server.close())));
    for (const server of servers) {
        const page = new URL(server.url);
        page.searchParams.set("view", "browser");
        const html = await (await fetch(page)).text();
        const icon = html.match(/<link(?=[^>]*rel="icon")[^>]*href="([^"]+)"/)?.[1];
        assert.ok(icon, "Browser page must declare its favicon");
        for (const path of [icon, "favicon.ico"]) {
            const response = await fetch(new URL(path, page));
            assert.equal(response.status, 200);
            assert.match(response.headers.get("content-type"), /^image\/(?:png|svg\+xml)/);
            const data = Buffer.from(await response.arrayBuffer());
            assert.ok(data.length > 100);
            if (response.headers.get("content-type").includes("svg")) {
                assert.match(data.toString(), /<svg/);
                assert.doesNotMatch(data.toString(), /<script|https?:\/\/(?!www\.w3\.org)/);
            } else assert.equal(data.readUInt32BE(0), 0x89504e47);
        }
    }
});
