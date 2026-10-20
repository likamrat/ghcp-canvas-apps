export const escapeHtml = value => String(value).replace(/[&<>"']/g, character =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));

function inline(text) {
    const pattern = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
    let html = "", offset = 0;
    for (const match of text.matchAll(pattern)) {
        html += escapeHtml(text.slice(offset, match.index));
        if (match[1]) html += `<code>${escapeHtml(match[1])}</code>`;
        else if (match[4]) html += `<strong>${escapeHtml(match[4])}</strong>`;
        else {
            let url;
            try { url = new URL(match[3]); } catch { url = null; }
            html += url && ["http:", "https:"].includes(url.protocol)
                ? `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(match[2])}</a>`
                : escapeHtml(match[0]);
        }
        offset = match.index + match[0].length;
    }
    return html + escapeHtml(text.slice(offset));
}

export function renderMarkdown(text, { title } = {}) {
    const lines = text.replaceAll("\r\n", "\n").split("\n");
    if (title && lines[0] === `# ${title}`) lines.shift();
    const output = [];
    let paragraph = [], list = null, fence = null, code = [];
    const flush = () => {
        if (paragraph.length) { output.push(`<p>${inline(paragraph.join(" "))}</p>`); paragraph = []; }
        if (list) { output.push(`</${list}>`); list = null; }
    };
    for (const line of lines) {
        const boundary = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
        if (fence) {
            if (boundary && boundary[1][0] === fence[0] && boundary[1].length >= fence.length) {
                output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
                fence = null; code = [];
            } else code.push(line);
            continue;
        }

        if (boundary) { flush(); fence = boundary[1]; continue; }
        if (!line.trim()) { flush(); continue; }
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) { flush(); const level = Math.min(6, heading[1].length + 1); output.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue; }
        const item = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.+)$/);
        if (item) {
            const kind = /^\s*\d/.test(line) ? "ol" : "ul";
            if (paragraph.length || (list && list !== kind)) flush();
            if (!list) { output.push(`<${kind}>`); list = kind; }
            const task = item[1].match(/^\[([ xX])\]\s+(.+)$/);
            output.push(task ? `<li class="task"><label><input type="checkbox" ${task[1] !== " " ? "checked " : ""}disabled> ${inline(task[2])}</label></li>` : `<li>${inline(item[1])}</li>`);
            continue;
        }
        if (list) flush();
        if (line.startsWith("> ")) { flush(); output.push(`<blockquote>${inline(line.slice(2))}</blockquote>`); }
        else paragraph.push(line);
    }
    flush();
    if (fence) output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    return output.join("\n");
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
