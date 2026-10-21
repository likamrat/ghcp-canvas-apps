import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startServer as artifacts } from "../apps/artifacts/server.mjs";
import { startServer as screenshots } from "../apps/screenshots/server.mjs";
import { startServer as monitor } from "../apps/context-monitor/server.mjs";
import { startServer as thoughts } from "../apps/thoughts/server.mjs";

test("all app headers use the same theme-aware wordmark and control treatment", async t => {
    const apps = ["artifacts", "screenshots", "context-monitor", "thoughts"];
    const names = ["Artifacts", "Screenshots", "Context Monitor", "Thoughts"];
    const servers = [await artifacts({}), await screenshots({}), await monitor(() => ({})), await thoughts({})];
    t.after(() => Promise.all(servers.map(server => server.close())));
    const canonical = await readFile(new URL("../apps/artifacts/branding.css", import.meta.url), "utf8");
    for (const [index, app] of apps.entries()) {
        const server = servers[index];
        const html = await (await fetch(server.url)).text();
        assert.ok(html.includes(`class="app-wordmark" aria-label="${names[index]}"`), `${app} has an accessible wordmark`);
        assert.doesNotMatch(html, /__APP_WORDMARK__/);
        assert.match(html, /class="word-prefix" fill="currentColor"/);
        assert.match(html, /class="icon-halo"/);
        assert.match(html, /class="[^"]*\brefresh-control\b[^"]*"/);
        const browserButton = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]).find(tag => tag.includes('id="open-browser"'));
        assert.match(browserButton, /class="[^"]*\bcontrol-button\b/, `${app} uses the shared action control`);
        if (app !== "thoughts") {
            const panel = html.match(/<details\b[^>]*class="control-panel"[^>]*>/)?.[0];
            assert.ok(panel, `${app} has a collapsible filter panel`);
            assert.doesNotMatch(panel, /\sopen(?:\s|=|>)/, `${app} starts collapsed`);
            assert.match(html, /<summary class="filter-heading">Filters and refresh<\/summary>/);
        }
        for (const file of ["branding.css", "filter.svg", "refresh.svg", "ui-icons.svg"]) {
            const response = await fetch(new URL(file, server.url));
            assert.equal(response.status, 200, `${app} serves ${file}`);
            if (file === "branding.css") assert.equal(await response.text(), canonical);
            else assert.equal(await response.text(), await readFile(new URL(`../apps/artifacts/${file}`, import.meta.url), "utf8"));
        }
        assert.equal(await readFile(new URL(`../apps/${app}/branding.css`, import.meta.url), "utf8"), canonical);
        assert.equal(await readFile(new URL(`../apps/${app}/branding.mjs`, import.meta.url), "utf8"),
            await readFile(new URL("../apps/artifacts/branding.mjs", import.meta.url), "utf8"));
    }
    assert.match(canonical, /data-color-mode="dark"/);
    assert.match(canonical, /prefers-color-scheme: dark/);
    assert.match(canonical, /fill:\s*currentColor/);
    assert.match(canonical, /color:\s*var\(--surface/);
    assert.match(canonical, /\.filter-heading::before\s*\{[^}]*mask-image:\s*url\("\.\/filter\.svg"\)/);
    assert.match(canonical, /mask:\s*url\("\.\/refresh\.svg"\)/);
    assert.match(canonical, /--control-height:\s*36px/);
    assert.match(canonical, /--control-height:\s*44px/);
    assert.match(canonical, /--control-radius:\s*6px/);
    const icons = await readFile(new URL("../apps/artifacts/ui-icons.svg", import.meta.url), "utf8");
    const symbols = new Set([...icons.matchAll(/<symbol id="([^"]+)"/g)].map(match => match[1]));
    for (const app of apps) {
        const html = await readFile(new URL(`../apps/${app}/index.html`, import.meta.url), "utf8");
        for (const [, symbol] of html.matchAll(/ui-icons\.svg#([^"]+)/g)) {
            assert.ok(symbols.has(symbol), `${app} references the bundled ${symbol} icon`);
        }
    }
});
