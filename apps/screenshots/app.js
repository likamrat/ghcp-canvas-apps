import { defaultView, clearFilters, queryImages, sessionTree, createRequestGate, SOURCE_LABELS } from "./model.mjs";

const $ = (id) => document.getElementById(id);
const view = defaultView();
const fields = { sessionSearch: "session-search", includeArchived: "include-archived", includeChildren: "include-children",
    filename: "filename", source: "source", from: "from", to: "to", sort: "sort", order: "order", group: "group", thumbnail: "thumbnail" };
const scopeGate = createRequestGate();
const sessionGate = createRequestGate();
const collapsed = new Set();
const counts = new Map();
let sessions = [], images = [], ordered = [], selected = null, previewId = null, previewTrigger = null;
let imageWarnings = [], sessionWarnings = [], limit = 120, sessionLimit = 300;
let scanning = false, pending = false, loadingSessions = false, collectedAt = null, imageRevision = 0;
let zoom = null, previewRevision = 0;

function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
}
function notice(id, message) { $(id).textContent = message || ""; $(id).hidden = !message; }
function busy() {
    $("refresh").disabled = scanning || loadingSessions;
    $("refresh").textContent = scanning || loadingSessions ? "Reading..." : "Refresh";
}
async function api(route) {
    const response = await fetch(new URL(route, location.href), { cache: "no-store" });
    if (!response.ok) {
        const body = await response.text();
        let message = body;
        try { message = JSON.parse(body).error || body; } catch { /* Non-JSON transport errors remain visible. */ }
        throw new Error(message || `Request failed (${response.status}).`);
    }
    return response.json();
}
const dateText = (image) => image.timestamp ? new Date(image.timestamp).toLocaleString() : "Time unknown";
const bytes = (value) => value == null ? "Unknown size" : value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1048576).toFixed(1)} MiB`;
const imageUrl = (id) => new URL(`image/${id}?revision=${imageRevision}`, location.href).href;

function renderSessions() {
    const rows = sessionTree(sessions, view, collapsed);
    $("session-count").textContent = `(${rows.length})`;
    $("sessions").replaceChildren();
    $("session-picker").replaceChildren(new Option("Select a session", ""));
    for (const session of sessionTree(sessions, view)) {
        $("session-picker").add(new Option(`${"  ".repeat(Math.min(session.depth, 8))}${session.name}${session.archived ? " (archived)" : ""}`, session.id));
    }
    $("session-picker").value = selected || "";
    for (const session of rows.slice(0, sessionLimit)) {
        const row = node("div", null, "session-row");
        row.style.setProperty("--depth", String(session.depth));
        if (session.childCount) {
            const fold = node("button", collapsed.has(session.id) ? "+" : "-", "fold");
            fold.type = "button";
            fold.dataset.sessionId = session.id;
            fold.setAttribute("aria-label", `${collapsed.has(session.id) ? "Expand" : "Collapse"} ${session.name}`);
            fold.setAttribute("aria-expanded", String(!collapsed.has(session.id) || Boolean(view.sessionSearch)));
            fold.onclick = () => {
                if (collapsed.has(session.id)) collapsed.delete(session.id); else collapsed.add(session.id);
                renderSessions();
                $("sessions").querySelector(`.fold[data-session-id="${CSS.escape(session.id)}"]`)?.focus();
            };
            row.append(fold);
        }
        const button = node("button", null, "session-button");
        button.type = "button";
        button.setAttribute("aria-current", String(session.id === selected));
        button.append(node("span", session.name, "session-name"));
        const count = counts.get(session.id);
        const label = [session.project, session.archived ? "Archived" : null,
            count == null ? "Images not loaded" : `${count} known image${count === 1 ? "" : "s"}`].filter(Boolean).join(" / ");
        button.append(node("span", label, "session-meta"));
        button.onclick = () => selectSession(session.id);
        row.append(button);
        $("sessions").append(row);
    }
    if (rows.length > sessionLimit) {
        const more = node("button", "Show more sessions");
        more.onclick = () => { sessionLimit += 300; renderSessions(); };
        $("sessions").append(more);
    }
    if (!rows.length) $("sessions").append(node("p", sessions.length ? "No sessions match these controls." : "No local sessions found.", "muted"));
    $("sessions").setAttribute("aria-busy", String(loadingSessions));
}

function empty(title, help) {
    const element = node("div", null, "empty");
    element.append(node("h2", title), node("p", help));
    $("gallery").replaceChildren(element);
    $("more").hidden = true;
}

function renderGallery() {
    let query;
    try {
        query = queryImages(images, view);
        notice("date-error", null);
        $("from").removeAttribute("aria-invalid"); $("to").removeAttribute("aria-invalid");
    } catch (error) {
        notice("date-error", error.message);
        $("from").setAttribute("aria-invalid", "true"); $("to").setAttribute("aria-invalid", "true");
        $("summary").textContent = "Invalid date range. Showing the previous results.";
        return;
    }
    ordered = query.images;
    if (previewId && !ordered.some((image) => image.id === previewId)) {
        $("viewer").close();
        notice("error", "The preview was closed because its image is no longer in the current results.");
        $("refresh").focus();
    } else if (previewId) renderPreview();
    $("gallery").dataset.size = view.thumbnail;
    $("gallery").setAttribute("aria-busy", String(scanning));
    const session = sessions.find((row) => row.id === selected);
    const scope = view.includeChildren ? "including child sessions" : "selected session only";
    $("summary").textContent = selected ? `${session?.name || "Session"} / ${ordered.length} of ${query.total} known images / ${scope}` : "Select a session to browse its screenshots.";
    $("sync").textContent = collectedAt ? `Last read ${new Date(collectedAt).toLocaleTimeString()}` : "Manual refresh";
    notice("warnings", [...new Set([...sessionWarnings, ...imageWarnings])].join("\n"));
    if (!selected) { empty("Choose a session", "Select a session from the navigator to load its uploaded images and tool screenshots."); return; }
    if (scanning && !images.length) {
        $("gallery").replaceChildren(node("div", null, "skeleton"));
        return;
    }
    if (!images.length) { empty("No retained images", "This session has no supported local image references. Check source warnings or include child sessions."); return; }
    if (!ordered.length) { empty("No matching screenshots", "Change the source or dates, search a different filename, or clear the filters."); return; }
    $("gallery").replaceChildren();
    let shown = 0;
    for (const group of query.groups) {
        if (shown >= limit) break;
        const section = node("section", null, "image-group");
        const label = view.group === "day" && group.key !== "unknown" ? new Date(`${group.key}T12:00:00`).toLocaleDateString(undefined, { dateStyle: "long" }) : group.label;
        section.append(node("h2", `${label} (${group.images.length})`, "group-heading"));
        const grid = node("div", null, "image-grid");
        for (const image of group.images) {
            if (shown++ >= limit) break;
            const button = node("button", null, "image-card");
            button.type = "button";
            button.dataset.imageId = image.id;
            button.setAttribute("aria-label", `Preview ${image.name}, ${image.availability}`);
            const thumbnail = node("span", null, "thumbnail");
            if (image.availability === "available") {
                const img = document.createElement("img");
                img.alt = ""; img.loading = "lazy"; img.decoding = "async";
                img.width = image.width; img.height = image.height; img.src = imageUrl(image.id);
                img.onerror = () => thumbnail.replaceChildren(node("span", "Preview unavailable. Refresh to retry.", "image-unavailable"));
                thumbnail.append(img);
            } else thumbnail.append(node("span", image.reason, "image-unavailable"));
            const caption = node("span", null, "image-caption");
            caption.append(node("span", image.name, "image-name"));
            caption.append(node("span", `${dateText(image)} (${image.timestampBasis})`, "image-meta"));
            caption.append(node("span", [SOURCE_LABELS[image.source], view.includeChildren ? image.sessionName : null].filter(Boolean).join(" / "), "image-meta"));
            button.append(thumbnail, caption);
            button.onclick = () => openPreview(image.id, button);
            grid.append(button);
        }
        section.append(grid);
        $("gallery").append(section);
    }
    $("more").hidden = ordered.length <= limit;
    $("more").textContent = `Show more (${Math.max(0, ordered.length - limit)} remaining)`;
}

function selectSession(id) {
    if (!id || id === selected) return;
    selected = id; images = []; imageWarnings = []; collectedAt = null; limit = 120;
    if ($("viewer").open) $("viewer").close();
    renderSessions();
    requestImages();
}

async function requestImages() {
    scopeGate.next();
    pending = true;
    if (scanning) { renderGallery(); return; }
    scanning = true;
    busy();
    while (pending) {
        pending = false;
        const revision = scopeGate.next();
        const sessionId = selected;
        if (!sessionId) break;
        renderGallery();
        try {
            const params = new URLSearchParams({ sessionId, includeChildren: String(view.includeChildren), includeArchived: String(view.includeArchived) });
            const result = await api(`api/images?${params}`);
            if (!scopeGate.current(revision)) continue;
            images = result.images; imageWarnings = result.warnings; collectedAt = result.collectedAt; imageRevision++;
            for (const id of result.scannedSessionIds ?? [sessionId]) counts.set(id, images.filter((image) => image.sessionId === id).length);
            notice("error", null);
        } catch (error) {
            if (scopeGate.current(revision)) {
                notice("error", `${error.message} Use Refresh to retry.`);
                imageWarnings = ["Image discovery failed; any existing gallery results may be out of date."];
            }
        }
    }
    scanning = false;
    busy(); renderSessions(); renderGallery();
}

async function refresh() {
    const revision = sessionGate.next();
    loadingSessions = true; busy();
    try {
        const result = await api("api/sessions");
        if (!sessionGate.current(revision)) return;
        sessions = result.sessions; sessionWarnings = result.warnings;
        const eligible = sessions.filter((session) => view.includeArchived || !session.archived);
        if (!eligible.some((session) => session.id === selected)) {
            const requested = new URL(location.href).searchParams.get("session");
            selected = eligible.find((session) => session.id === requested)?.id ||
                [...eligible].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]?.id || null;
            images = []; imageWarnings = [];
        }
        notice("error", null);
        renderSessions();
        await requestImages();
    } catch (error) { notice("error", `${error.message} Use Refresh to retry.`); empty("Sessions unavailable", "The local metadata source could not be read. Your files have not been changed."); }
    finally {
        if (sessionGate.current(revision)) { loadingSessions = false; busy(); renderSessions(); $("gallery").setAttribute("aria-busy", "false"); }
    }
}

function openPreview(id, trigger) {
    previewId = id; previewTrigger = trigger; zoom = null;
    renderPreview();
    $("viewer").showModal();
    $("close-preview").focus();
}
function renderPreview() {
    const index = ordered.findIndex((image) => image.id === previewId);
    if (index < 0) return;
    const image = ordered[index];
    const revision = ++previewRevision;
    $("preview-name").textContent = image.name;
    $("position").textContent = `${index + 1} of ${ordered.length}`;
    $("previous").disabled = index === 0;
    $("next").disabled = index === ordered.length - 1;
    for (const id of ["fit", "actual", "zoom-in", "zoom-out"]) $(id).disabled = image.availability !== "available";
    $("preview-image")?.remove();
    const img = document.createElement("img");
    img.id = "preview-image";
    img.hidden = true;
    $("preview-error").hidden = false;
    $("preview-error").textContent = image.availability === "available" ? "Loading preview..." : image.reason;
    img.onload = () => {
        if (revision !== previewRevision) return;
        img.hidden = false; $("preview-error").hidden = true;
        updateZoom();
    };
    img.onerror = () => {
        if (revision !== previewRevision) return;
        img.hidden = true; $("preview-error").textContent = "This image could not be decoded or has changed. Close the preview and refresh to retry.";
    };
    if (image.availability === "available") {
        img.alt = `${image.name}, ${image.sessionName}`;
        img.src = imageUrl(image.id);
        $("preview-anchor").after(img);
    }
    $("details").replaceChildren();
    const details = [
        ["Session", image.sessionName], ["Source", SOURCE_LABELS[image.source]], ["Tool", image.tool || "Not reported"],
        ["Timestamp", `${dateText(image)} (${image.timestampBasis})`],
        ["Dimensions", image.width ? `${image.width} x ${image.height}` : "Unknown"], ["File size", bytes(image.size)],
        ["Location", image.path || "No retained local path"],
    ];
    for (const [label, value] of details) {
        const field = node("div", null, label === "Location" ? "path-detail" : "");
        field.append(node("dt", label), node("dd", value)); $("details").append(field);
    }
    updateZoom();
}
function updateZoom() {
    const img = $("preview-image");
    const image = ordered.find((item) => item.id === previewId);
    $("preview-stage").classList.toggle("fit", zoom === null);
    if (img) {
        img.style.width = zoom === null ? "" : `${(image?.width || img.naturalWidth) * zoom}px`;
        img.style.height = zoom === null ? "" : `${(image?.height || img.naturalHeight) * zoom}px`;
    }
    $("fit").setAttribute("aria-pressed", String(zoom === null));
    $("actual").setAttribute("aria-pressed", String(zoom === 1));
    $("zoom").textContent = zoom === null ? "Fit" : `${Math.round(zoom * 100)}%`;
}
function stepPreview(delta) {
    const index = ordered.findIndex((image) => image.id === previewId);
    const next = ordered[index + delta];
    if (next) { previewId = next.id; zoom = null; $("preview-stage").scrollTo(0, 0); renderPreview(); }
}
function scaleZoom(factor) {
    const image = ordered.find((item) => item.id === previewId);
    if (!image) return;
    const stage = $("preview-stage");
    const fitted = Math.min(stage.clientWidth / image.width, stage.clientHeight / image.height, 1);
    zoom = Math.min(8, Math.max(.1, (zoom ?? fitted) * factor));
    updateZoom();
}

for (const [key, id] of Object.entries(fields)) {
    const field = $(id);
    field.addEventListener(field.type === "search" ? "input" : "change", () => {
        view[key] = field.type === "checkbox" ? field.checked : field.value;
        limit = 120;
        if (key === "includeArchived") {
            if (!view.includeArchived && sessions.find((session) => session.id === selected)?.archived) {
                selected = null; images = []; imageWarnings = [];
            }
            renderSessions(); requestImages();
        } else if (key === "includeChildren") {
            images = []; requestImages();
        } else if (key === "sessionSearch") renderSessions();
        else renderGallery();
    });
}
$("clear").onclick = () => {
    Object.assign(view, clearFilters(view));
    for (const [key, id] of Object.entries(fields)) if (!["includeArchived", "includeChildren"].includes(key)) $(id).value = view[key];
    limit = 120; renderSessions(); renderGallery();
};
$("refresh").onclick = refresh;
$("session-picker").onchange = (event) => selectSession(event.target.value);
$("more").onclick = () => { limit += 120; renderGallery(); };
$("close-preview").onclick = () => $("viewer").close();
$("viewer").addEventListener("close", () => {
    previewId = null; previewRevision++; $("preview-image")?.remove();
    if (previewTrigger?.isConnected) previewTrigger.focus();
    else $("refresh").focus();
});
$("viewer").addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); stepPreview(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); stepPreview(1); }
});
$("previous").onclick = () => stepPreview(-1);
$("next").onclick = () => stepPreview(1);
$("fit").onclick = () => { zoom = null; updateZoom(); };
$("actual").onclick = () => { zoom = 1; updateZoom(); };
$("zoom-in").onclick = () => scaleZoom(1.25);
$("zoom-out").onclick = () => scaleZoom(.8);
refresh();
