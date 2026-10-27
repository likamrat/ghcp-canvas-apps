import { SOURCES, defaultFilters, queryArtifacts, reconcileView, createRequestGate, catalogPresentation, applyPinResult, artifactLabel } from "./model.mjs";
import { renderMarkdown, parseDelimited, localReference, escapeHtml as esc } from "./render.mjs";
import { createRefreshCycle } from "./refresh.mjs";
import { createSessionPicker } from "./session-picker.mjs";

const $ = id => document.getElementById(id);
const state = {
    sessions: [], records: [], sessionId: new URL(location.href).searchParams.get("session"),
    includeChildren: false, includeArchived: false, pendingPins: new Set(),
    filters: defaultFilters(), view: { selectedId: null, revision: null, page: 1, pageSize: 16, layout: "workspace" },
    tab: "preview", content: null, busy: false, queued: false, updatedAt: null, zoom: 1, selection: "",
    phase: "loading", hasSnapshot: false,
};
const layout = new URL(location.href).searchParams.get("layout");
if (["workspace", "library", "activity"].includes(layout)) state.view.layout = layout;
const scanGate = createRequestGate(), readGate = createRequestGate();
let editing = null;
let downloading = false, lastDownload = null;
let openingImage = false;
const sessionPicker = createSessionPicker({ onSelect: changeSession });
const kindLabels = { document: "Document", image: "Image", diagram: "Diagram", table: "Table", file: "File" };
const glyphNames = new Set(["document", "image", "diagram", "table", "pin", "folder", "list", "grid", "history", "chevron", "back", "forward", "eye", "info", "download", "message", "edit", "minus", "plus", "reset"]);
const glyph = kind => `<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><use href="ui-icons.svg#${glyphNames.has(kind) ? kind : "document"}"/></svg>`;
for (const element of document.querySelectorAll("[data-icon]")) element.innerHTML = glyph(element.dataset.icon);
const selected = () => state.records.find(record => record.id === state.view.selectedId);
const session = () => state.sessions.find(row => row.id === state.sessionId);
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Unknown date";
const size = value => value == null ? "Size unavailable" : value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1048576).toFixed(1)} MiB`;
const button = (action, text, attributes = "", className = "control-button") => `<button type="button" class="${className}" data-action="${action}" ${attributes}>${text}</button>`;
const iconButton = (action, label, icon, attributes = "", tooltip = label) => button(action, glyph(icon),
    `aria-label="${esc(label)}" title="${esc(tooltip)}" ${attributes}`, "control-button icon-button");
const pinButton = record => {
    const label = record.pinned ? "Unpin" : "Pin";
    return iconButton("pin", `${label} ${artifactLabel(record)}`, "pin",
        `data-id="${esc(record.id)}" aria-pressed="${record.pinned}" ${state.pendingPins.has(record.id) ? "disabled" : ""}`, label);
};
const fileUrl = record => {
    const url = new URL(`file/${record.id}`, location.href);
    if (state.view.selectedId === record.id && state.view.revision) url.searchParams.set("version", state.view.revision);
    return url.href;
};
function markdownResourceUrl(record, ref) {
    const url = new URL(`resource/${record.id}`, location.href);
    url.searchParams.set("ref", ref);
    if (state.view.revision) url.searchParams.set("version", state.view.revision);
    url.hash = new URL(ref, "https://markdown.invalid/").hash;
    return url.href;
}
function markdownLink(record, ref) {
    const path = localReference(ref);
    if (!path) return null;
    if (/\.(?:png|jpe?g|gif|webp|svg)$/i.test(path)) return markdownResourceUrl(record, ref);
    const normalize = value => {
        const normalized = value.replaceAll("\\", "/").replace(/^\/(?=[a-z]:)/i, "");
        return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
    };
    let candidates;
    if (record.path) {
        const base = new URL("file:///");
        base.pathname = record.path.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/");
        const target = normalize(decodeURIComponent(new URL(path.split("/").map(encodeURIComponent).join("/"), base).pathname));
        candidates = state.records.filter(item => item.path && normalize(item.path) === target);
    } else candidates = state.records.filter(item => item.sessionId === record.sessionId && item.name === path);
    const sameSession = candidates.filter(item => item.sessionId === record.sessionId);
    if (sameSession.length === 1) candidates = sameSession;
    return candidates.length === 1 ? `#artifact-${candidates[0].id}` : null;
}
function setError(message) { $("error").textContent = message; $("error").hidden = !message; }
async function api(path, input, headers = {}) {
    const response = await fetch(new URL(path, location.href), input === undefined ? {} : {
        method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(input),
    });
    const content = await response.text();
    let result;
    try { result = JSON.parse(content); } catch { throw new Error(`Artifacts could not read the server response (${response.status}). Reopen the canvas if its session ended.`); }
    if (!response.ok) throw new Error(result.error || `Artifacts request failed (${response.status}).`);
    return result;
}
async function openImageWindow(record) {
    if (!record || openingImage) return;
    const trigger = $("preview-image");
    const status = $("image-error");
    openingImage = true;
    trigger?.setAttribute("aria-disabled", "true");
    if (status) { status.hidden = false; status.textContent = "Opening image window..."; status.setAttribute("role", "status"); }
    try {
        await api("api/open-image", { id: record.id }, { "x-canvas-popout": "1" });
        if (status?.isConnected) { status.textContent = ""; status.hidden = true; }
    } catch (error) {
        if (status?.isConnected) {
            status.textContent = error.message; status.hidden = false; status.setAttribute("role", "alert");
        } else setError(error.message);
    } finally {
        openingImage = false;
        for (const image of document.querySelectorAll("#preview-image")) image.removeAttribute("aria-disabled");
    }
}
function downloadNotice(message, saved = null) {
    lastDownload = saved;
    $("download-status").textContent = message;
    $("download-notice").hidden = false;
    $("open-download-folder").hidden = !saved?.downloadId;
}
async function downloadArtifact(record) {
    if (!record || downloading) return;
    const input = { id: record.id, ...(state.view.revision ? { version: state.view.revision } : {}) };
    downloading = true;
    for (const control of document.querySelectorAll('[data-action="download"]')) control.disabled = true;
    downloadNotice(`Saving ${record.name}...`);
    try {
        const saved = await api("api/save-download", input);
        downloadNotice(`Saved ${saved.name} to ${saved.path}`, saved);
    } catch (error) { downloadNotice(`Download failed: ${error.message}`); }
    finally {
        downloading = false;
        for (const control of document.querySelectorAll('[data-action="download"]')) control.disabled = false;
    }
}
$("dismiss-download").addEventListener("click", () => {
    $("download-notice").hidden = true;
    (document.querySelector('[data-action="download"]:not(:disabled)') ?? $("refresh")).focus();
});
$("open-download-folder").addEventListener("click", async () => {
    const saved = lastDownload;
    if (!saved?.downloadId) return;
    $("open-download-folder").disabled = true;
    try {
        const result = await api("api/open-download-folder", { downloadId: saved.downloadId });
        if (lastDownload?.downloadId === saved.downloadId) {
            $("download-status").textContent = result.selected ? `Opened folder with ${saved.name} selected. Saved at ${saved.path}`
                : `Opened the download folder. Saved at ${saved.path}`;
        }
    } catch (error) {
        if (lastDownload?.downloadId === saved.downloadId) downloadNotice(`Could not open folder: ${error.message} Saved at ${saved.path}`, saved);
    } finally { $("open-download-folder").disabled = false; }
});
function syncStatus() {
    const interval = Number($("auto-refresh").value);
    $("sync").textContent = state.phase === "loading" ? "Reading local artifacts..." :
        `${state.updatedAt ? `Updated ${date(state.updatedAt)}` : "Not refreshed yet"} · ${interval ? `Auto-refresh every ${interval / 1000} seconds${document.hidden ? " (paused while hidden)" : ""}` : "Auto-refresh off"}`;
}
function presentation(matching = state.records.length) {
    return catalogPresentation({ phase: state.phase, hasSnapshot: state.hasSnapshot,
        hasSession: Boolean(session()), total: state.records.length, matching });
}
function loadingMarkup(reader = false) {
    return `<div class="load-state" role="status"><span class="loading-spinner" aria-hidden="true"></span>
        <h2>${reader ? "Preparing the preview..." : "Loading artifacts..."}</h2>
        <p>${reader ? "The preview will appear when the files are ready." : "Reading this session's files."}</p>
        <div class="loading-lines" aria-hidden="true"><span></span><span></span><span></span></div></div>`;
}
function beginScopeLoad() {
    readGate.next();
    state.phase = "loading"; state.hasSnapshot = false;
    state.records = []; state.content = null; state.updatedAt = null; state.selection = "";
    setError(""); showWarnings([]);
}
const refreshCycle = createRefreshCycle({ refresh: () => refresh() });
async function refresh() {
    if (state.busy) { state.queued = true; scanGate.next(); return; }
    state.busy = true;
    state.phase = "loading";
    refreshCycle.setBusy(true);
    $("refresh").disabled = true;
    setError("");
    if (!state.hasSnapshot) showWarnings([]);
    if (!state.hasSnapshot || !state.records.length) {
        renderList();
        void loadSelected();
    } else $("artifact-list").setAttribute("aria-busy", "true");
    syncStatus();
    const request = scanGate.next();
    try {
        const params = new URLSearchParams();
        if (state.sessionId) params.set("sessionId", state.sessionId);
        const snapshot = await api(`api/sessions?${params}`);
        if (!scanGate.current(request)) return;
        if (!snapshot.sessions.length && snapshot.warnings?.length) throw new Error(snapshot.warnings.join(" "));
        state.sessions = snapshot.sessions;
        if (snapshot.defaultSessionId) state.sessionId = snapshot.defaultSessionId;
        renderSessions();
        $("new-note").disabled = !session() || session().location !== "local";
        if (!session()) {
            state.phase = state.sessionId ? "error" : "idle"; state.hasSnapshot = false;
            state.records = []; renderList(); await loadSelected();
            $("scope-summary").textContent = "Choose a session.";
            showWarnings(snapshot.warnings);
            setError(state.sessionId ? "The selected session is no longer available. Choose another session." : "");
            return;
        }
        $("open-browser").dataset.sessionId = state.sessionId;
        const scope = new URLSearchParams({ sessionId: state.sessionId, includeChildren: String(state.includeChildren), includeArchived: String(state.includeArchived) });
        const result = await api(`api/artifacts?${scope}`);
        if (!scanGate.current(request)) return;
        state.records = result.artifacts;
        state.phase = "ready"; state.hasSnapshot = true;
        state.updatedAt = result.collectedAt;
        setError("");
        showWarnings([...(snapshot.warnings ?? []), ...(result.warnings ?? [])]);
        renderList();
        await loadSelected(true);
    } catch (error) {
        if (scanGate.current(request)) {
            state.phase = "error";
            setError(`${error.message}${state.updatedAt ? ` Last successful refresh: ${date(state.updatedAt)}.` : ""}`);
            renderList();
            if (!state.hasSnapshot) void loadSelected();
            if (!state.sessions.length) $("scope-summary").textContent = "Sessions unavailable";
        }
    } finally {
        state.busy = false;
        refreshCycle.setBusy(false);
        $("refresh").disabled = false;
        syncStatus();
        if (state.queued) { state.queued = false; void refresh(); }
    }
}
function showWarnings(warnings = []) {
    const unique = [...new Set(warnings)];
    $("warnings").hidden = !unique.length;
    $("warnings").querySelector("summary").textContent = `Discovery notes (${unique.length})`;
    $("warning-list").replaceChildren(...unique.map(message => {
        const li = document.createElement("li"); li.textContent = message; return li;
    }));
}
function renderSessions() {
    sessionPicker.update({ sessions: state.sessions, selectedId: state.sessionId, includeArchived: state.includeArchived });
}
function applyFilters() {
    const old = state.view.selectedId;
    renderList();
    if (state.view.selectedId !== old) { state.zoom = 1; state.selection = ""; }
    void loadSelected();
}
function row(record, showDate = true) {
    const source = SOURCES[record.source] ?? record.source;
    return `<article class="artifact-item" data-selected="${record.id === state.view.selectedId}">
        <button type="button" class="artifact-row" data-action="select" data-id="${esc(record.id)}" title="${esc(record.name)}" aria-current="${record.id === state.view.selectedId}">
        ${glyph(record.kind)}<span class="row-text"><span class="artifact-title">${esc(artifactLabel(record))}</span>
        <span class="artifact-meta">${esc(record.availability !== "available" ? record.reason || "Unavailable" : source)}${record.version ? ` · v${record.version}` : ""}</span>
        ${showDate ? `<span class="artifact-source">${esc(date(record.timestamp))}</span>` : ""}</span></button>${pinButton(record)}</article>`;
}
function card(record) {
    const image = ["image", "diagram"].includes(record.kind) && record.availability === "available";
    const excerpt = state.content?.metadata?.id === record.id ? state.content.content?.slice(0, 180) : null;
    return `<article class="library-card">
        <button type="button" class="card-open" data-action="select" data-id="${esc(record.id)}" title="${esc(record.name)}">
        <span class="card-preview">${image ? `<img src="${esc(fileUrl(record))}" alt="${esc(artifactLabel(record))}" loading="lazy">` :
            `<strong>${esc(artifactLabel(record))}</strong><small>${esc(record.availability !== "available" ? record.reason || "Unavailable" : excerpt || `${kindLabels[record.kind] ?? "File"} · ${size(record.size)}`)}</small>`}</span>
        <span class="card-title artifact-title">${esc(artifactLabel(record))}</span></button>
        <div class="card-footer"><span class="artifact-meta">${esc(SOURCES[record.source] ?? record.source)}${record.version ? ` · v${record.version}` : ""}</span>${pinButton(record)}</div></article>`;
}
function renderList() {
    $("surface").dataset.layout = state.view.layout;
    $("artifact-list").setAttribute("aria-busy", String(state.phase === "loading"));
    for (const control of document.querySelectorAll("button[data-layout]")) control.setAttribute("aria-pressed", String(control.dataset.layout === state.view.layout));
    $("view-label").textContent = { workspace: "List", library: "Gallery", activity: "Timeline" }[state.view.layout];
    $("view-icon").innerHTML = glyph({ workspace: "list", library: "grid", activity: "history" }[state.view.layout]);
    $("collection-all").setAttribute("aria-pressed", String(!state.filters.pinned));
    $("collection-pinned").setAttribute("aria-pressed", String(state.filters.pinned));
    const display = presentation();
    if (["loading", "error", "idle"].includes(display)) {
        $("artifact-list").innerHTML = display === "loading" ? loadingMarkup() :
            display === "error" ? `<div class="empty"><h2>Artifacts could not be loaded</h2>${button("refresh", "Retry")}</div>` :
                '<div class="empty"><h2>Choose a session</h2><p>Select a session to read its artifacts.</p></div>';
        $("scope-summary").textContent = display === "loading" ? `${session()?.name ?? "Local sessions"} · Loading artifacts...` :
            display === "error" ? "Artifacts unavailable" : "Choose a session.";
        $("page-summary").textContent = display === "loading" ? "Loading..." : "";
        $("previous-page").disabled = true; $("next-page").disabled = true;
        return;
    }
    let records;
    try {
        records = queryArtifacts(state.records, state.filters);
        $("filter-error").hidden = true;
        $("from").removeAttribute("aria-invalid"); $("to").removeAttribute("aria-invalid");
    } catch (error) {
        $("filter-error").textContent = error.message; $("filter-error").hidden = false;
        $("from").setAttribute("aria-invalid", "true"); $("to").setAttribute("aria-invalid", "true");
        if ($("artifact-list").querySelector(".load-state")) $("artifact-list").innerHTML = '<p class="empty">Check the filters above to see the results.</p>';
        return;
    }
    const previousSelection = state.view.selectedId;
    state.view = reconcileView(state.view, records);
    if (!state.view.selectedId) $("surface").classList.remove("show-detail");
    if (previousSelection !== state.view.selectedId) { state.selection = ""; state.zoom = 1; }
    const start = (state.view.page - 1) * state.view.pageSize;
    const page = records.slice(start, start + state.view.pageSize);
    const noPins = state.filters.pinned && state.records.length > 0 && !state.records.some(record => record.pinned);
    $("scope-summary").textContent = `${records.length} of ${state.records.length} artifacts${state.filters.pinned ? " · Pinned" : ""}${state.includeChildren ? " · Including child sessions" : ""}`;
    $("artifact-list").innerHTML = !page.length ? `<div class="empty"><h2>${noPins ? "No pinned artifacts" : state.records.length ? "No matching artifacts" : "No artifacts found"}</h2><p>${noPins ? "Choose All artifacts and use the pin beside a file to keep it here." : state.records.length ? "Change or clear the filters." : session()?.location !== "local" && session() ? "Remote files are not available through the local adapter." : "Publish a note or refresh after the session creates a supported file."}</p></div>` :
        state.view.layout === "library" ? page.map(card).join("") :
        state.view.layout === "activity" ? page.map(record => `<article class="activity-entry"><p>${esc(date(record.timestamp))} · ${esc(record.source === "published" ? `Published version ${record.version}` : record.timestampBasis || "File reference")}</p>${row(record, false)}</article>`).join("") : page.map(record => row(record)).join("");
    for (const image of $("artifact-list").querySelectorAll("img")) image.addEventListener("error", () => {
        const text = document.createElement("small"); text.textContent = "Preview unavailable. Open the artifact for details."; image.replaceWith(text);
    }, { once: true });
    $("page-summary").textContent = `${records.length ? start + 1 : 0}–${Math.min(start + state.view.pageSize, records.length)} of ${records.length}`;
    $("previous-page").disabled = state.view.page <= 1;
    $("next-page").disabled = state.view.page >= state.view.pages;
}
function detailList(record) {
    const values = [["Source session", record.sessionName], ["Source", SOURCES[record.source] ?? record.source],
        ["File", record.name], ["Path", record.path ?? "Stored in Artifacts"], ["Availability", record.availability],
        ["Size", size(record.size)], ["Date", date(record.timestamp)], ["Date basis", record.timestampBasis],
        ["Tool", record.tool ?? "Not recorded"], ["Event", record.eventId ?? "Not recorded"], ["Artifact ID", record.id]];
    return `<dl class="artifact-details">${values.map(([label, value]) => `<dt>${label}</dt><dd>${esc(value ?? "Not recorded")}</dd>`).join("")}</dl>`;
}
function revisions(record, list) {
    return list.length ? `<div class="revision-list">${[...list].sort((a, b) => b.version - a.version).map(item =>
        button("revision", `<span>Version ${item.version}${item.version === record.version ? " · Latest" : ""}<span class="revision-time">${esc(date(item.timestamp))}</span></span>`,
            `data-version="${item.version}" aria-pressed="${item.version === (state.view.revision ?? record.version)}"`, "revision")).join("")}</div>` :
        '<p class="captured-note">This is a discovered file reference. Earlier file contents were not captured.</p>';
}
function renderReaderHeader(record, metadata = record, ready = false) {
    $("reader-title").textContent = record ? artifactLabel(metadata) : "Selected artifact";
    $("reader-title").title = record?.name ?? "";
    $("reader-meta").textContent = record ? `${SOURCES[record.source] ?? record.source} · ${date(metadata.timestamp)}${metadata.version ? ` · Version ${metadata.version}` : ""}` : "";
    $("reader-actions").innerHTML = !ready ? "" : `${pinButton(record)}
        ${record.availability === "available" ? `${iconButton("download", "Download artifact", "download", downloading ? "disabled" : "")}
        ${button("request", `${glyph("message")}<span>Request a change</span>`)}` : ""}
        ${record.source === "published" && !state.view.revision ? iconButton("edit", "Edit note", "edit") : ""}`;
}
async function loadSelected(preserveScroll = false) {
    const request = readGate.next(), record = selected(), container = $("reader-content");
    const scroll = preserveScroll ? container.scrollTop : 0;
    for (const control of document.querySelectorAll("[data-tab]")) control.setAttribute("aria-pressed", String(control.dataset.tab === state.tab));
    if (!record) {
        state.content = null;
        renderReaderHeader(null);
        const display = presentation();
        $("reader").setAttribute("aria-busy", String(display === "loading"));
        container.innerHTML = display === "loading" ? loadingMarkup(true) :
            display === "error" ? '<p class="empty">Refresh to retry loading this session.</p>' :
                '<p class="empty">Select an artifact to preview it.</p>';
        return;
    }
    $("reader").setAttribute("aria-busy", "true");
    if (!preserveScroll || state.content?.metadata?.id !== record.id) {
        renderReaderHeader(record);
        container.innerHTML = '<p class="empty" role="status">Loading artifact...</p>';
    }
    let result;
    try {
        const query = state.view.revision ? `?version=${state.view.revision}` : "";
        if (record.availability !== "available") result = { metadata: record, content: null, revisions: await api(`api/revisions/${record.id}`) };
        else result = await api(`api/content/${record.id}${query}`);
        if (!readGate.current(request)) return;
        state.content = result;
        const metadata = result.metadata;
        renderReaderHeader(selected(), metadata, true);
        const historyNotice = state.view.revision ? `<p class="notice">Captured version ${state.view.revision}. ${button("latest", "Back to latest")}</p>` : "";
        let body;
        if (state.tab === "details") body = detailList(record);
        else if (state.tab === "versions") body = `${revisions(record, result.revisions)}<p class="captured-note">Source: ${esc(record.sessionName)}${record.tool ? ` · ${esc(record.tool)}` : ""}. Only captured note versions are available; file references do not contain a complete edit history.</p>`;
        else if (record.availability !== "available") body = `<div class="notice">${esc(record.reason || "The original file is unavailable.")}</div>${detailList(record)}`;
        else if (["image", "diagram"].includes(record.kind)) body = `<div class="image-tools" role="group" aria-label="Image zoom">${iconButton("zoom-out", "Zoom out", "minus")}<span id="zoom-label">${Math.round(state.zoom * 100)}%</span>${iconButton("zoom-in", "Zoom in", "plus")}${iconButton("zoom-reset", "Reset zoom", "reset")}</div><p id="image-error" class="error-text" role="alert" hidden></p><div class="image-frame"><img id="preview-image" src="${esc(fileUrl(record))}" alt="${esc(artifactLabel(record))}" role="button" tabindex="0" aria-label="Open ${esc(artifactLabel(record))} in a separate image window" title="Open image in a separate window"${openingImage ? ' aria-disabled="true"' : ""}></div>`;
        else if (record.kind === "table" && result.content !== null) {
            const table = parseDelimited(result.content, record.name.toLowerCase().endsWith(".tsv") ? "\t" : ",");
            const wide = table.rows.some(row => row.length > 32);
            body = `${table.truncated || wide ? '<p class="notice">Preview limited to 200 rows and 32 columns. Download the file for the full table.</p>' : ""}<div class="table-scroll"><table>${table.rows.map((row, index) => `<tr>${row.slice(0, 32).map(cell => `<${index ? "td" : "th"}>${esc(cell)}</${index ? "td" : "th"}>`).join("")}</tr>`).join("")}</table></div>`;
        } else if (result.content !== null) body = /\.(?:md|markdown)$/i.test(record.name) || record.source === "published"
            ? `<div class="prose" id="artifact-prose">${renderMarkdown(result.content, {
                title: metadata.title, resolveImage: ref => markdownResourceUrl(record, ref),
                resolveLink: ref => markdownLink(record, ref),
            })}</div>` : `<pre id="artifact-prose"><code>${esc(result.content)}</code></pre>`;
        else body = `<p class="notice">${esc(kindLabels[record.kind] ?? "File")} preview is not available here. Download it to open in its usual application.</p>${detailList(record)}`;
        container.innerHTML = `${historyNotice}${body}`;
        container.scrollTop = scroll;
        for (const image of container.querySelectorAll(".prose img")) image.addEventListener("error", () => {
            const notice = document.createElement("p");
            notice.className = "markdown-image-unavailable";
            notice.setAttribute("role", "status");
            notice.textContent = `Image could not be loaded${image.alt ? `: ${image.alt}` : ""}. It may be missing, blocked, or changed. Refresh to retry.`;
            image.replaceWith(notice);
        }, { once: true });
        const image = $("preview-image");
        if (image) {
            image.addEventListener("click", () => { void openImageWindow(record); });
            image.addEventListener("keydown", event => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault(); void openImageWindow(record);
                }
            });
            image.addEventListener("load", applyZoom, { once: true });
            image.addEventListener("error", () => { $("image-error").textContent = "The image could not be read. Refresh to retry."; $("image-error").hidden = false; }, { once: true });
            if (image.complete && image.naturalWidth) applyZoom();
        }
    } catch (error) {
        if (!readGate.current(request)) return;
        state.content = null;
        renderReaderHeader(record);
        container.innerHTML = `<p class="notice error-text" role="alert">${esc(error.message)}</p>${button("retry-preview", "Retry preview")} ${button("refresh", "Refresh artifacts")}`;
    } finally { if (readGate.current(request)) $("reader").setAttribute("aria-busy", "false"); }
}
function applyZoom() {
    const image = $("preview-image");
    if (!image?.naturalWidth) return;
    const width = Math.min(image.naturalWidth, image.parentElement.clientWidth - 32);
    image.style.maxWidth = "none"; image.style.width = `${Math.max(1, Math.round(width * state.zoom))}px`;
    $("zoom-label").textContent = `${Math.round(state.zoom * 100)}%`;
}
function changeSession(id) {
    state.sessionId = id || null; beginScopeLoad();
    state.view.selectedId = null; state.view.revision = null; state.view.page = 1;
    state.selection = ""; $("surface").classList.remove("show-detail");
    renderSessions(); renderList(); void loadSelected(); void refresh();
}
function chooseArtifact(id) {
    state.view.selectedId = id; state.view.revision = null; state.tab = "preview"; state.zoom = 1; state.selection = "";
    $("surface").classList.add("show-detail"); renderList(); void loadSelected();
}
function filtersChanged() {
    state.filters = { search: $("search").value, kinds: [...$("kinds").selectedOptions].map(option => option.value),
        sources: [...$("sources").selectedOptions].map(option => option.value), pinned: state.filters.pinned,
        from: $("from").value, to: $("to").value, sort: $("sort").value, order: $("order").value };
    state.view.page = 1; applyFilters();
}
function clearFilters() {
    $("search").value = ""; $("from").value = ""; $("to").value = ""; state.filters.pinned = false;
    for (const name of ["kinds", "sources"]) {
        for (const option of $(name).options) option.selected = false;
        $(name).dispatchEvent(new Event("multiselect-sync"));
    }
    filtersChanged();
}
function openNote(edit = false) {
    const record = selected();
    editing = edit ? { id: record.id, sessionId: record.sessionId, expectedVersion: state.content.metadata.version } : { sessionId: state.sessionId };
    $("note-heading").textContent = edit ? "Edit note" : "New note";
    $("note-title").value = edit ? state.content.metadata.title : "";
    $("note-content").value = edit ? state.content.content : "";
    $("note-error").hidden = true; $("save-note").disabled = false; $("note-dialog").showModal(); $("note-title").focus();
}
function closeNote() { $("note-dialog").close(); editing = null; }
$("note-form").addEventListener("submit", async event => {
    event.preventDefault();
    const input = { ...editing, title: $("note-title").value, content: $("note-content").value };
    $("save-note").disabled = true; $("note-error").hidden = true;
    try {
        const record = await api("api/publish", input);
        closeNote(); state.view.selectedId = record.id; state.view.revision = null;
        state.records = [record, ...state.records.filter(item => item.id !== record.id)];
        renderList(); await loadSelected(); $("surface").classList.add("show-detail");
        void refresh();
        if (!queryArtifacts(state.records, state.filters).some(item => item.id === record.id)) $("sync").textContent = "Note saved. Current filters hide it.";
    } catch (error) { $("note-error").textContent = error.message; $("note-error").hidden = false; }
    finally { $("save-note").disabled = false; }
});
for (const id of ["close-note", "cancel-note"]) $(id).addEventListener("click", closeNote);
$("note-dialog").addEventListener("cancel", () => { editing = null; });
$("new-note").addEventListener("click", () => openNote());
$("refresh").addEventListener("click", () => refresh());
$("clear-filters").addEventListener("click", clearFilters);
for (const id of ["search", "from", "to"]) $(id).addEventListener("input", filtersChanged);
for (const id of ["kinds", "sources", "sort", "order"]) $(id).addEventListener("change", filtersChanged);
for (const [id, key] of [["include-children", "includeChildren"], ["include-archived", "includeArchived"]]) $(id).addEventListener("change", () => {
    state[key] = $(id).checked; beginScopeLoad(); renderSessions(); renderList(); void loadSelected(); void refresh();
});
$("page-size").addEventListener("change", () => { state.view.pageSize = Number($("page-size").value); state.view.page = 1; renderList(); });
$("previous-page").addEventListener("click", () => { state.view.page--; renderList(); });
$("next-page").addEventListener("click", () => { state.view.page++; renderList(); });
$("auto-refresh").addEventListener("change", () => { refreshCycle.setInterval(Number($("auto-refresh").value)); syncStatus(); });
document.addEventListener("visibilitychange", () => { refreshCycle.setHidden(document.hidden); syncStatus(); });
window.addEventListener("pagehide", () => refreshCycle.stop());
window.addEventListener("pageshow", () => refreshCycle.resume());
document.addEventListener("mouseup", () => {
    const selection = window.getSelection();
    if (selection?.toString().trim() && selection.anchorNode?.parentElement?.closest("#artifact-prose")) state.selection = selection.toString().trim();
});
$("back").addEventListener("click", () => $("surface").classList.remove("show-detail"));
document.addEventListener("click", event => {
    if (!$("view-menu").contains(event.target)) $("view-menu").open = false;
});
document.addEventListener("keydown", event => {
    if (event.key === "Escape" && $("view-menu").open) {
        $("view-menu").open = false; $("view-menu").querySelector("summary").focus();
    }
});
document.addEventListener("click", async event => {
    const link = event.target.closest("#artifact-prose a");
    const linkedId = link?.getAttribute("href")?.match(/^#artifact-([a-f0-9]{64})$/)?.[1];
    if (linkedId) {
        event.preventDefault();
        if (!$("filter-error").hidden) clearFilters();
        let records = queryArtifacts(state.records, state.filters);
        if (!records.some(item => item.id === linkedId)) { clearFilters(); records = queryArtifacts(state.records, state.filters); }
        const index = records.findIndex(item => item.id === linkedId);
        if (index < 0) { setError("This linked artifact is no longer available. Refresh to retry."); return; }
        state.view.page = Math.floor(index / state.view.pageSize) + 1;
        chooseArtifact(linkedId);
        return;
    }
    const target = event.target.closest("button");
    if (!target) return;
    if (target.dataset.layout) {
        state.view.layout = target.dataset.layout; $("surface").classList.remove("show-detail");
        if (state.view.layout === "activity") { $("sort").value = "timestamp"; state.filters.sort = "timestamp"; }
        const url = new URL(location.href); url.searchParams.set("layout", state.view.layout); window.history.replaceState(null, "", url);
        $("view-menu").open = false; $("view-menu").querySelector("summary").focus();
        renderList(); return;
    }
    if (target.dataset.collection) {
        state.filters.pinned = target.dataset.collection === "pinned";
        state.view.page = 1; applyFilters(); return;
    }
    if (target.dataset.tab) { state.tab = target.dataset.tab; void loadSelected(); return; }
    const action = target.dataset.action, record = selected();
    if (action === "download") { await downloadArtifact(record); return; }
    if (action === "select") { chooseArtifact(target.dataset.id); return; }
    if (action === "refresh") { void refresh(); return; }
    if (action === "retry-preview") { void loadSelected(); return; }
    if (action === "revision") { state.view.revision = Number(target.dataset.version); state.tab = "preview"; void loadSelected(); return; }
    if (action === "latest") { state.view.revision = null; void loadSelected(); return; }
    if (action?.startsWith("zoom-")) {
        state.zoom = action === "zoom-reset" ? 1 : Math.max(.25, Math.min(4, state.zoom + (action === "zoom-in" ? .25 : -.25))); applyZoom(); return;
    }
    if (action === "pin") {
        const item = state.records.find(item => item.id === target.dataset.id);
        if (!item || state.pendingPins.has(item.id)) return;
        const scope = state.sessionId;
        const hadFocus = document.activeElement === target, inList = $("artifact-list").contains(target);
        let restoreFocus = hadFocus;
        state.pendingPins.add(item.id);
        const pinControls = () => [...document.querySelectorAll('button[data-action="pin"]')].filter(control => control.dataset.id === item.id);
        for (const control of pinControls()) control.disabled = true;
        try {
            const updated = await api("api/pin", { id: item.id, pinned: !item.pinned });
            state.records = applyPinResult(state.records, updated, scope, state.sessionId);
            if (scope !== state.sessionId) return;
            state.pendingPins.delete(item.id);
            if (state.busy) { state.queued = true; scanGate.next(); }
            restoreFocus = hadFocus && (document.activeElement === target || document.activeElement === document.body);
            const previous = state.view.selectedId;
            renderList();
            if (previous !== state.view.selectedId || item.id === state.view.selectedId) await loadSelected(true);
            setError("");
        } catch (error) { if (scope === state.sessionId) setError(error.message); }
        finally {
            state.pendingPins.delete(item.id);
            for (const control of pinControls()) control.disabled = false;
            if (scope === state.sessionId && restoreFocus && (document.activeElement === target || document.activeElement === document.body)) {
                const container = inList ? $("artifact-list") : $("reader-actions");
                const replacement = [...container.querySelectorAll('button[data-action="pin"]')].find(control => control.dataset.id === item.id);
                (replacement ?? $("collection-pinned")).focus({ preventScroll: true });
            }
        }
        return;
    }
    if (action === "edit" && record && state.content) openNote(true);
    if (action === "request" && record) {
        $("request-content").value = `Please review "${record.title || record.name}" from session "${record.sessionName}".\nArtifact ID: ${record.id}\n${record.path ? `File: ${record.path}\n` : ""}${record.version ? `Captured version: ${state.view.revision ?? record.version}\n` : ""}\n${state.selection ? `Selected artifact content:\n"""${state.selection}"""\n\n` : ""}Suggest the next useful change.`;
        $("copy-status").textContent = ""; $("request-dialog").showModal();
    }
});
$("close-request").addEventListener("click", () => $("request-dialog").close());
$("copy-request").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("request-content").value); $("copy-status").textContent = "Copied. Paste it into Copilot chat."; }
    catch { $("copy-status").textContent = "Clipboard access failed. Select and copy the request text manually."; $("request-content").select(); }
});
refreshCycle.setHidden(document.hidden);
void refresh();
