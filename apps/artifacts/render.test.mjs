import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, parseDelimited, markdownReferences, localReference } from "./render.mjs";

test("Markdown previews format text without executing HTML or unsafe links", () => {
    const html = renderMarkdown("# Plan\n\n<script>alert(1)</script>\n\n[Run](javascript:alert)\n\n[Docs](https://docs.github.com)\n\n- **Read** this\n- [x] Done\n\n```html\n<img src=x onerror=alert(1)>\n```");
    assert.match(html, /<h2 id="md-plan">Plan<\/h2>/);
    assert.doesNotMatch(html, /<script|<img|href="javascript:/);
    assert.match(html, /href="https:\/\/docs.github.com\/"/);
    assert.match(html, /<strong>Read<\/strong>/);
    assert.match(html, /checked disabled/);
    assert.match(html, /<pre><code/);
    assert.doesNotMatch(renderMarkdown("# Plan\n\nContent", { title: "Plan" }), /<h2>/);
    assert.match(renderMarkdown("# Another heading", { title: "Plan" }), /<h2[^>]*>Another heading/);
});

test("README HTML images and links render as content while code examples remain literal", () => {
    const text = '<p align="center"><img src="logo.svg" alt="Artifacts logo" width="440"></p>\n\n' +
        '<a href="screenshot.png"><img src="screenshot.png" alt="Preview" width="960" onerror="alert(1)"></a>\n\n' +
        '![Diagram](images/flow.svg)\n\n```html\n<img src="example.png">\n```';
    const html = renderMarkdown(text, { resolveImage: ref => `/asset?ref=${encodeURIComponent(ref)}` });
    assert.match(html, /<p class="markdown-align-center"><img src="\/asset\?ref=logo.svg"/);
    assert.match(html, /<a href="screenshot.png"[^>]*><img src="\/asset\?ref=screenshot.png"/);
    assert.match(html, /src="\/asset\?ref=images%2Fflow.svg"/);
    assert.doesNotMatch(html, / onerror=/);
    assert.match(html, /&lt;img src=&quot;example.png&quot;&gt;/);
    assert.deepEqual([...markdownReferences(text)].sort(), ["images/flow.svg", "logo.svg", "screenshot.png"]);
});

test("Markdown supports tables, nested lists, emphasis, headings, and read-only task lists", () => {
    const html = renderMarkdown("## Results\n\n| Name | Status |\n| :--- | ---: |\n| *Preview* | **Ready** |\n\n- Parent\n  - Child\n\n- [x] Complete\n\n[Jump](#results)");
    assert.match(html, /<div class="table-scroll"><table>/);
    assert.match(html, /markdown-align-right/);
    assert.match(html, /<em>Preview<\/em>/);
    assert.match(html, /<ul>[\s\S]*<ul>[\s\S]*Child/);
    assert.match(html, /checked disabled/);
    assert.match(html, /href="#md-results"/);
});

test("active HTML, DOM clobbering, remote images, and encoded unsafe URLs are excluded", () => {
    const html = renderMarkdown('<script>alert(1)</script><style>body{display:none}</style>' +
        '<svg><foreignObject><img src="secret.png"></foreignObject></svg>' +
        '<iframe src="https://example.com"></iframe><form id="note-form"><input name="location"></form>' +
        '<img src="https://example.com/tracker.png" srcset="https://example.com/other.png" onload="alert(1)">' +
        '<a href="java&#x73;cript:alert(1)" onclick="alert(1)">Run</a>' +
        '<div id="reader" data-action="pin" style="position:fixed">Text</div>');
    assert.doesNotMatch(html, /<(?:script|style|svg|iframe|form|input|img)\b|id="reader"|data-action=|onclick=|onload=|srcset=|javascript:/);
    assert.match(html, /Remote image not loaded/);
    assert.match(html, /<div>Text<\/div>/);
    for (const ref of ["https://example.com/a.png", "//example.com/a.png", "\\\\host\\a.png",
        "file:///C:/private.png", "C:\\private.png", "data:image/png,abc", "%2fprivate.png", "a%00.png", "CON.png", "images/LPT1.svg"]) {
        assert.equal(localReference(ref), null, ref);
    }
    assert.equal(localReference("./images/a%20b.png?v=1#preview"), "./images/a b.png");
});

test("table previews parse quoted fields and report clipped or malformed data", () => {
    assert.deepEqual(parseDelimited('Name,Note\r\n"Plan, one","Line one\nLine two"\r\nQuote,"A ""word"""').rows,
        [["Name", "Note"], ["Plan, one", "Line one\nLine two"], ["Quote", 'A "word"']]);
    assert.equal(parseDelimited("a\nb\nc", ",", 2).truncated, true);
    assert.deepEqual(parseDelimited("a\tb\n1\t2", "\t").rows, [["a", "b"], ["1", "2"]]);
    assert.throws(() => parseDelimited('a,"broken'), /quoted/i);
});
