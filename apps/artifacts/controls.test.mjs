import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("actions and view switches use one control class instead of per-button sizing", async () => {
    const html = await readFile(new URL("index.html", import.meta.url), "utf8");
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]);
    for (const id of ["new-note", "refresh", "open-browser", "clear-filters", "previous-page", "next-page",
        "session-picker", "session-picker-close", "session-picker-current", "session-picker-top",
        "close-note", "cancel-note", "save-note", "close-request", "copy-request"]) {
        const button = buttons.find(tag => tag.includes(`id="${id}"`));
        assert.ok(button && /class="[^"]*\bcontrol-button\b/.test(button), `${id} uses the standard control`);
    }
    for (const layout of ["workspace", "library", "activity"]) {
        const button = buttons.find(tag => tag.includes(`data-layout="${layout}"`));
        assert.ok(button && /class="[^"]*\bcontrol-button\b/.test(button), `${layout} uses the standard control`);
    }
    const css = await readFile(new URL("style.css", import.meta.url), "utf8");
    assert.match(css, /--control-height:\s*36px/);
    assert.match(css, /--control-height:\s*44px/);
    assert.doesNotMatch(css, /#open-browser\s*\{/);
    assert.doesNotMatch(css, /\.view-switch button\s*\{/);
    assert.doesNotMatch(css, /\.pagination button\s*\{/);
    assert.doesNotMatch(css, /\.reader-actions button/);
});
