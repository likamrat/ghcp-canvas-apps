import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, parseDelimited } from "./render.mjs";

test("Markdown previews format text without executing HTML or unsafe links", () => {
    const html = renderMarkdown("# Plan\n\n<script>alert(1)</script>\n\n[Run](javascript:alert)\n\n[Docs](https://docs.github.com)\n\n- **Read** this\n- [x] Done\n\n```html\n<img src=x onerror=alert(1)>\n```");
    assert.match(html, /<h2>Plan<\/h2>/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script|<img|href="javascript:/);
    assert.match(html, /href="https:\/\/docs.github.com\/"/);
    assert.match(html, /<strong>Read<\/strong>/);
    assert.match(html, /checked disabled/);
    assert.match(html, /<pre><code/);
    assert.doesNotMatch(renderMarkdown("# Plan\n\nContent", { title: "Plan" }), /<h2>/);
    assert.match(renderMarkdown("# Another heading", { title: "Plan" }), /<h2>Another heading/);
});

test("table previews parse quoted fields and report clipped or malformed data", () => {
    assert.deepEqual(parseDelimited('Name,Note\r\n"Plan, one","Line one\nLine two"\r\nQuote,"A ""word"""').rows,
        [["Name", "Note"], ["Plan, one", "Line one\nLine two"], ["Quote", 'A "word"']]);
    assert.equal(parseDelimited("a\nb\nc", ",", 2).truncated, true);
    assert.deepEqual(parseDelimited("a\tb\n1\t2", "\t").rows, [["a", "b"], ["1", "2"]]);
    assert.throws(() => parseDelimited('a,"broken'), /quoted/i);
});
