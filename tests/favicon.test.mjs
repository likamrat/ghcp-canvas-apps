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

test("each app has one complete background-backed logo and a matching Lucide app icon", async () => {
    const luminance = (hex) => {
        const rgb = hex.match(/[a-f0-9]{2}/gi).map((part) => parseInt(part, 16) / 255)
            .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    for (const [app, name] of [["screenshots", "Screenshots"], ["context-monitor", "Context Monitor"], ["thoughts", "Thoughts"]]) {
        const base = new URL(`../apps/${app}/`, import.meta.url);
        const svg = await readFile(new URL("icon.svg", base), "utf8");
        assert.match(svg, /viewBox="0 0 64 64"/);
        assert.match(svg, /stroke-width="2"/);
        const stroke = svg.match(/stroke="(#[a-f0-9]{6})"/i)?.[1];
        const background = svg.match(/<rect width="64" height="64"[^>]*fill="(#[a-f0-9]{6})"/i)?.[1];
        assert.ok(stroke && background, "Use an explicit solid background and foreground");
        const values = [luminance(stroke), luminance(background)].sort((a, b) => b - a);
        assert.ok((values[0] + .05) / (values[1] + .05) >= 3, `${app} icon needs contrast against its own background`);
        const png = await readFile(new URL("icon.png", base));
        assert.equal(png.readUInt32BE(16), 512);
        assert.equal(png.readUInt32BE(20), 512);
        const projectIcon = await readFile(new URL(`../.github/extensions/${app}/icon.png`, import.meta.url));
        assert.deepEqual(projectIcon, png, "Project discovery and personal installation must use the same app icon");
        const readme = await readFile(new URL("README.md", base), "utf8");
        assert.equal(readme.split(/\r?\n/)[0], `# ${name}`, "Keep the original Markdown heading");
        assert.match(readme, /src="logo.svg"/);
        assert.doesNotMatch(readme, /<picture>|prefers-color-scheme|logo-(?:light|dark)/);
        const logo = await readFile(new URL("logo.svg", base), "utf8");
        assert.ok(logo.includes(`<title>${name}</title>`));
        assert.match(logo, /viewBox="0 0 920 220"/);
        assert.match(logo, /<rect width="920" height="220"[^>]*fill="#191c22"/);
        assert.match(logo, /<g[^>]+aria-label=/, "The logo must contain the outlined wordmark");
        assert.doesNotMatch(logo, /<text|<script|<image|@font-face|prefers-color-scheme/, "One logo must work without font, image, or theme dependencies");
        const wordmark = logo.slice(logo.indexOf(`<g aria-label="${name}"`));
        assert.equal((wordmark.match(/<path transform=/g) ?? []).length, name.length - 1,
            "The symbol replaces one letter; every other wordmark glyph belongs in the image");
    }
});
