import { marked, parseDocument } from "./vendor/markdown.mjs";

export const escapeHtml = value => String(value).replace(/[&<>"']/g, character =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));

const tags = new Set(["p", "div", "span", "a", "img", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
    "strong", "b", "em", "i", "del", "s", "code", "pre", "kbd", "samp", "sub", "sup",
    "blockquote", "ul", "ol", "li", "input", "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    "details", "summary", "figure", "figcaption"]);
const blocked = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "template",
    "noscript", "form", "button", "select", "textarea", "link", "meta", "base"]);
const imagePath = path => /\.(?:png|jpe?g|gif|webp|svg)$/i.test(path);
const slug = value => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s+/g, "-").slice(0, 200) || "section";

export function localReference(value) {
    if (typeof value !== "string" || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value) ||
        /^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(value.trim())) return null;
    try {
        const path = decodeURIComponent(value.trim().split(/[?#]/)[0]).replaceAll("\\", "/");
        const device = path.split("/").some(part => /^(?:con(?:in\$|out\$)?|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(part.trim()));
        return !path || device || /^[\\/]/.test(path) || /[<>:"|?*\x00-\x1f\x7f]/.test(path) ? null : path;
    } catch { return null; }
}

function webLink(value) {
    try {
        const url = new URL(value);
        return ["https:", "http:"].includes(url.protocol) ? url.href : null;
    } catch { return null; }
}

function tree(text) {
    return parseDocument(marked.parse(text, { gfm: true, async: false }), { decodeEntities: true });
}

export function markdownReferences(text) {
    const refs = new Set(), pending = [...tree(text).children];
    let count = 0;
    while (pending.length) {
        if (++count > 50000) throw new Error("This Markdown document is too complex to preview.");
        const node = pending.pop();
        if (blocked.has(node.name)) continue;
        const ref = node.name === "img" ? node.attribs.src : node.name === "a" ? node.attribs.href : null;
        const path = localReference(ref);
        if (path && imagePath(path)) refs.add(ref);
        if (node.children) pending.push(...node.children);
    }
    return refs;
}

export function renderMarkdown(text, { title, resolveImage, resolveLink } = {}) {
    const lines = text.replaceAll("\r\n", "\n").split("\n");
    if (title && lines[0] === `# ${title}`) lines.shift();
    const headings = new Map();
    let count = 0;
    const attribute = (name, value) => ` ${name}="${escapeHtml(value)}"`;
    const plainText = (node, depth = 0) => {
        if (depth > 64) throw new Error("Markdown nesting is too deep to preview.");
        if (blocked.has(node.name)) return "";
        return node.type === "text" ? node.data : (node.children ?? []).map(child => plainText(child, depth + 1)).join("");
    };
    function render(node, depth = 0) {
        if (++count > 50000 || depth > 64) throw new Error("This Markdown document is too complex to preview.");
        if (node.type === "text") return escapeHtml(node.data);
        if (node.type === "comment" || blocked.has(node.name)) return "";
        const children = () => (node.children ?? []).map(child => render(child, depth + 1)).join("");
        if (!tags.has(node.name)) return children();
        const attrs = node.attribs ?? {};
        let tag = node.name, attributes = "";
        if (tag === "img") {
            const path = localReference(attrs.src);
            const url = path && imagePath(path) ? (resolveImage ? resolveImage(attrs.src) : attrs.src) : null;
            if (!url) return `<span class="markdown-image-unavailable">${webLink(attrs.src) ? "Remote image not loaded" : "Image not loaded"}${attrs.alt ? `: ${escapeHtml(attrs.alt)}` : ""}.</span>`;
            attributes = attribute("src", url) + attribute("alt", attrs.alt ?? "") + ' loading="lazy" decoding="async"';
            for (const dimension of ["width", "height"]) {
                if (/^[1-9]\d{0,3}$/.test(attrs[dimension] ?? "")) attributes += attribute(dimension, attrs[dimension]);
            }
            return `<img${attributes}>`;
        }
        if (tag === "a") {
            const href = attrs.href ?? "";
            let url = webLink(href);
            if (href.startsWith("#")) {
                try { url = `#md-${slug(decodeURIComponent(href.slice(1)))}`; } catch { url = null; }
            } else if (!url && localReference(href)) {
                url = resolveLink ? resolveLink(href) : href;
            }
            if (!url) return `<span class="markdown-link-unavailable" title="This link is not available in the preview.">${children()}</span>`;
            attributes += attribute("href", url);
            if (!url.startsWith("#")) attributes += ' target="_blank" rel="noopener noreferrer"';
        }
        if (/^h[1-6]$/.test(tag)) {
            const name = slug(plainText(node)), previous = headings.get(name) ?? 0;
            headings.set(name, previous + 1);
            attributes += attribute("id", `md-${name}${previous ? `-${previous}` : ""}`);
            tag = `h${Math.min(6, Number(tag[1]) + 1)}`;
        }
        if (tag === "input") return attrs.type?.toLowerCase() === "checkbox"
            ? `<input type="checkbox" ${Object.hasOwn(attrs, "checked") ? "checked " : ""}disabled>` : "";
        if (tag === "li" && node.children?.some(child => child.name === "input" && child.attribs.type === "checkbox")) attributes += ' class="task"';
        if (tag === "code" && /^language-[\w-]{1,40}$/.test(attrs.class ?? "")) attributes += attribute("class", attrs.class);
        if (["p", "div", "th", "td"].includes(tag) && /^(?:left|center|right)$/i.test(attrs.align ?? "")) {
            attributes += attribute("class", `markdown-align-${attrs.align.toLowerCase()}`);
        }
        if (["th", "td"].includes(tag)) for (const span of ["colspan", "rowspan"]) {
            if (/^[1-9]\d?$/.test(attrs[span] ?? "")) attributes += attribute(span, attrs[span]);
        }
        if (tag === "ol" && /^\d{1,6}$/.test(attrs.start ?? "")) attributes += attribute("start", attrs.start);
        if (tag === "details" && Object.hasOwn(attrs, "open")) attributes += " open";
        if (attrs.title) attributes += attribute("title", attrs.title);
        if (["hr", "br"].includes(tag)) return `<${tag}>`;
        const result = `<${tag}${attributes}>${children()}</${tag}>`;
        return tag === "table" ? `<div class="table-scroll">${result}</div>` : result;
    }
    return tree(lines.join("\n")).children.map(node => render(node)).join("");
}

export function parseDelimited(text, delimiter = ",", limit = 200) {
    const rows = [];
    let row = [], field = "", quoted = false, closed = false;
    const pushField = () => { row.push(field); field = ""; closed = false; };
    const pushRow = () => { pushField(); rows.push(row); row = []; };
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (quoted) {
            if (character === '"') {
                if (text[index + 1] === '"') { field += '"'; index++; }
                else { quoted = false; closed = true; }
            } else field += character;
        } else if (character === delimiter) pushField();
        else if (character === "\r" || character === "\n") {
            if (character === "\r" && text[index + 1] === "\n") index++;
            pushRow();
            if (rows.length === limit) return { rows, truncated: index + 1 < text.length };
        } else if (character === '"' && !field && !closed) quoted = true;
        else {
            if (closed || character === '"') throw new Error("The table contains a malformed quoted field.");
            field += character;
        }
    }
    if (quoted) throw new Error("The table contains an unclosed quoted field.");
    if (field || row.length || closed) pushRow();
    return { rows, truncated: false };
}
