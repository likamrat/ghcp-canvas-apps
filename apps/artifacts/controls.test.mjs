import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { artifactLabel } from "./model.mjs";
import { escapeHtml } from "./render.mjs";

test("pin tooltips name only the action while accessible labels retain file context", async () => {
    const source = await readFile(new URL("app.js", import.meta.url), "utf8");
    const start = source.indexOf("const button ="), end = source.indexOf("const fileUrl =");
    assert.ok(start >= 0 && end > start);
    const render = runInNewContext(`${source.slice(start, end)}\npinButton`, {
        glyph: () => "<svg></svg>", esc: escapeHtml, artifactLabel, state: { pendingPins: new Set() },
    });
    for (const pinned of [false, true]) {
        const action = pinned ? "Unpin" : "Pin";
        const html = render({ id: "example", name: "notes & decisions.md", pinned });
        assert.equal(html.match(/title="([^"]+)"/)?.[1], action);
        assert.ok(html.includes(`aria-label="${action} notes &amp; decisions.md"`));
    }
});

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

test("canvas downloads use the saved-file API, retain the chosen revision, and report failures", async () => {
    const source = await readFile(new URL("app.js", import.meta.url), "utf8");
    const start = source.indexOf("function downloadNotice("), end = source.indexOf('$("dismiss-download")');
    assert.ok(start >= 0 && end > start);
    const controls = [{ disabled: false }], elements = new Map(), calls = [];
    const state = { view: { revision: 1 } };
    let resolve;
    const pending = new Promise(done => { resolve = done; });
    const context = {
        state, document: { querySelectorAll: () => controls },
        $: id => { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); },
        api: async (path, input) => { calls.push([path, input]); return pending; },
    };
    const download = runInNewContext(`let downloading = false, lastDownload = null;\n${source.slice(start, end)}\ndownloadArtifact`, context);
    const first = download({ id: "a".repeat(64), name: "note.md" });
    state.view.revision = 2;
    await download({ id: "b".repeat(64), name: "other.md" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "api/save-download");
    assert.equal(calls[0][1].version, 1);
    assert.equal(controls[0].disabled, true);
    resolve({ name: "note.md", path: "Downloads/note.md", downloadId: "saved" });
    await first;
    assert.equal(elements.get("download-status").textContent, "Saved note.md to Downloads/note.md");
    assert.equal(elements.get("open-download-folder").hidden, false);
    assert.equal(controls[0].disabled, false);
    context.api = async () => { throw new Error("Permission denied"); };
    await download({ id: "a".repeat(64), name: "note.md" });
    assert.match(elements.get("download-status").textContent, /Download failed: Permission denied/);
    assert.equal(elements.get("open-download-folder").hidden, true);
    assert.equal(controls[0].disabled, false);
});

test("download file helpers are identical in both independently installable apps", async () => {
    assert.equal(await readFile(new URL("download-files.mjs", import.meta.url), "utf8"),
        await readFile(new URL("../screenshots/download-files.mjs", import.meta.url), "utf8"));
});
