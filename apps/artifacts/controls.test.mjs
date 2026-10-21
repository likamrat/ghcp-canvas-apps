import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("session selection precedes filters and views in reading and keyboard order", async () => {
    const html = await readFile(new URL("index.html", import.meta.url), "utf8");
    const picker = html.indexOf('id="session-picker"');
    const filters = html.indexOf('id="filters"');
    const views = html.indexOf('class="view-switch"');
    assert.ok(picker > -1 && picker < filters && filters < views);
    assert.equal([...html.matchAll(/id="session-picker"/g)].length, 1);
});

test("actions and view switches use one control class instead of per-button sizing", async () => {
    const html = await readFile(new URL("index.html", import.meta.url), "utf8");
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]);
    for (const id of ["new-note", "refresh", "open-browser", "clear-filters", "previous-page", "next-page",
        "session-picker", "session-picker-close", "session-picker-current", "session-picker-top",
        "close-note", "cancel-note", "save-note", "close-request", "copy-request", "collection-all", "collection-pinned"]) {
        const button = buttons.find(tag => tag.includes(`id="${id}"`));
        assert.ok(button && /class="[^"]*\bcontrol-button\b/.test(button), `${id} uses the standard control`);
    }
    for (const layout of ["workspace", "library", "activity"]) {
        const button = buttons.find(tag => tag.includes(`data-layout="${layout}"`));
        assert.ok(button && /class="[^"]*\bcontrol-button\b/.test(button), `${layout} uses the standard control`);
    }
    const css = await readFile(new URL("style.css", import.meta.url), "utf8");
    const shared = await readFile(new URL("branding.css", import.meta.url), "utf8");
    assert.match(shared, /--control-height:\s*36px/);
    assert.match(shared, /--control-height:\s*44px/);
    assert.doesNotMatch(css, /#open-browser\s*\{/);
    assert.doesNotMatch(css, /\.view-switch button\s*\{/);
    assert.doesNotMatch(css, /\.pagination button\s*\{/);
    assert.doesNotMatch(css, /\.reader-actions button/);
});

test("artifact navigation and reader controls have distinct scopes", async () => {
    const html = await readFile(new URL("index.html", import.meta.url), "utf8");
    assert.match(html, /<aside class="artifact-nav" aria-label="Artifact navigator">/);
    assert.match(html, /<details id="view-menu"/);
    assert.match(html, /data-tab="versions"[^>]*>[\s\S]*?Versions<\/button>/);
    assert.match(html, /data-tab="details"[^>]*>[\s\S]*?File info<\/button>/);
    assert.doesNotMatch(html, /data-tab="activity"|class="session-sidebar"/);
    assert.ok(html.indexOf('id="reader-actions"') < html.indexOf('id="reader-content"'));
});
