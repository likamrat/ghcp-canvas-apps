import test from "node:test";
import assert from "node:assert/strict";
import { startServer as screenshots } from "../apps/screenshots/server.mjs";
import { startServer as monitor } from "../apps/context-monitor/server.mjs";
import { startServer as thoughts } from "../apps/thoughts/server.mjs";
import { readFile } from "node:fs/promises";

test("all apps declare and serve bundled favicons in standalone browser views", async (t) => {
    const servers = [await screenshots({}), await monitor(() => ({})), await thoughts({})];
    t.after(() => Promise.all(servers.map((server) => server.close())));
    for (const [index, server] of servers.entries()) {
        const app = ["screenshots", "context-monitor", "thoughts"][index];
        const base = new URL(`../apps/${app}/`, import.meta.url);
        const page = new URL(server.url);
        page.searchParams.set("view", "browser");
        const html = await (await fetch(page)).text();
        const icon = html.match(/<link(?=[^>]*rel="icon")[^>]*href="([^"]+)"/)?.[1];
        assert.ok(icon, "Browser page must declare its favicon");
        assert.ok(icon.endsWith("icon.svg"), "Favicon must use the same scalable icon as the README");
        for (const path of [icon, "favicon.ico"]) {
            const response = await fetch(new URL(path, page));
            assert.equal(response.status, 200);
            assert.match(response.headers.get("content-type"), /^image\/(?:png|svg\+xml)/);
            const data = Buffer.from(await response.arrayBuffer());
            const canonical = await readFile(new URL(response.headers.get("content-type").includes("svg") ? "icon.svg" : "icon.png", base));
            assert.deepEqual(data, canonical);
            assert.ok(data.length > 100);
            if (response.headers.get("content-type").includes("svg")) {
                assert.match(data.toString(), /<svg/);
                assert.doesNotMatch(data.toString(), /<script|https?:\/\/(?!www\.w3\.org)/);
            } else assert.equal(data.readUInt32BE(0), 0x89504e47);
        }
    }
});

test("README app icons use one scalable Lucide glyph with sufficient light and dark contrast", async () => {
    const luminance = (hex) => {
        const rgb = hex.match(/[a-f0-9]{2}/gi).map((part) => parseInt(part, 16) / 255)
            .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    for (const [app, name] of [["screenshots", "Screenshots"], ["context-monitor", "Context Monitor"], ["thoughts", "Thoughts"]]) {
        const base = new URL(`../apps/${app}/`, import.meta.url);
        const svg = await readFile(new URL("icon.svg", base), "utf8");
        assert.match(svg, /viewBox="0 0 24 24"/);
        assert.match(svg, /stroke-width="2"/);
        const stroke = svg.match(/stroke="(#[a-f0-9]{6})"/i)?.[1];
        assert.ok(stroke, "Use a fixed visible stroke, independent of GitHub's theme or inherited CSS");
        for (const background of ["#ffffff", "#f6f8fa", "#0d1117", "#161b22", "#22272e"]) {
            const values = [luminance(stroke), luminance(background)].sort((a, b) => b - a);
            assert.ok((values[0] + .05) / (values[1] + .05) >= 3, `${app} icon needs 3:1 contrast on ${background}`);
        }
        const png = await readFile(new URL("icon.png", base));
        assert.equal(png.readUInt32BE(16), 512);
        assert.equal(png.readUInt32BE(20), 512);
        assert.equal(png[25], 6, "PNG app icon must retain its alpha channel");
        const projectIcon = await readFile(new URL(`../.github/extensions/${app}/icon.png`, import.meta.url));
        assert.deepEqual(projectIcon, png, "Project discovery and personal installation must use the same app icon");
        const readme = await readFile(new URL("README.md", base), "utf8");
        assert.ok(readme.startsWith('<h1><img src="icon.svg"'));
        assert.ok(readme.split("\n")[0].includes(name));
    }
});
