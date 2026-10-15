import { defaultView, clearFilters, queryImages, paginateImages, sessionTree, createRequestGate, SOURCE_LABELS } from "./model.mjs";

const $ = (id) => document.getElementById(id);
const view = defaultView();
const fields = { sessionSearch: "session-search", includeArchived: "include-archived", includeChildren: "include-children",
    filename: "filename", source: "source", from: "from", to: "to", sort: "sort", order: "order", group: "group", thumbnail: "thumbnail", pageSize: "page-size" };
const scopeGate = createRequestGate();
const sessionGate = createRequestGate();
const collapsed = new Set();
const counts = new Map();
let sessions = [], images = [], ordered = [], selected = null, previewId = null, previewTrigger = null;
let imageWarnings = [], sessionWarnings = [], page = 1, sessionLimit = 300;
let scanning = false, pending = false, loadingSessions = false, collectedAt = null, imageRevision = 0;
let zoom = null, previewRevision = 0;
let downloadingAll = false;

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
    const current = sessions.find((session) => session.id === selected);
    $("session-picker-value").textContent = current ? `${current.name}${current.archived ? " (archived)" : ""}` : "Select a session";
    $("session-picker").disabled = !sessionTree(sessions, view).length;
    if (!$("session-options").hidden) closeSessionPicker($("session-options").contains(document.activeElement));
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

function closeSessionPicker(restoreFocus = false) {
    $("session-options").hidden = true;
    $("session-picker").setAttribute("aria-expanded", "false");
    if (restoreFocus) $("session-picker").focus();
}

function openSessionPicker(last = false) {
    const rows = sessionTree(sessions, view);
    if (!rows.length) return;
    pickerSearch = "";
    const menu = $("session-options");
    menu.replaceChildren();
    for (const session of rows) {
        const option = node("button", `${session.name}${session.archived ? " (archived)" : ""}`, "session-option");
        option.type = "button";
        option.tabIndex = -1;
        option.style.paddingLeft = `${8 + Math.min(session.depth, 8) * 12}px`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(session.id === selected));
        option.onclick = () => {
            closeSessionPicker(true);
            selectSession(session.id);
        };
        menu.append(option);
    }
    menu.hidden = false;
    $("session-picker").setAttribute("aria-expanded", "true");
    const options = [...menu.children];
    const active = options.find((option) => option.getAttribute("aria-selected") === "true") ?? (last ? options.at(-1) : options[0]);
    active.focus({ preventScroll: true });
    menu.scrollTop = active.offsetTop - menu.clientHeight / 2;
}

function empty(title, help) {
    const element = node("div", null, "empty");
    element.append(node("h2", title), node("p", help));
    $("gallery").replaceChildren(element);
    $("pagination").hidden = true;
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
    $("download-all").disabled = downloadingAll || scanning || !ordered.some((image) => image.availability === "available");
    $("download-all").title = "Download available screenshots matching the current filters across all pages as a ZIP";
    const pagination = paginateImages(query, page, view.pageSize);
    page = pagination.page;
    $("pagination").hidden = !ordered.length;
    $("page-range").textContent = `${pagination.start}-${pagination.end} of ${pagination.matching} screenshots`;
    $("page-status").textContent = `Page ${page} of ${pagination.pages}`;
    $("page-previous").disabled = page === 1;
    $("page-next").disabled = page === pagination.pages;
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
        $("pagination").hidden = true;
        $("gallery").replaceChildren(node("div", null, "skeleton"));
        return;
    }
    if (!images.length) { empty("No retained images", "This session has no supported local image references. Check source warnings or include child sessions."); return; }
    if (!ordered.length) { empty("No matching screenshots", "Change the source or dates, search a different filename, or clear the filters."); return; }
    $("gallery").replaceChildren();
    for (const group of pagination.groups) {
        const section = node("section", null, "image-group");
        const label = view.group === "day" && group.key !== "unknown" ? new Date(`${group.key}T12:00:00`).toLocaleDateString(undefined, { dateStyle: "long" }) : group.label;
        section.append(node("h2", `${label} (${group.total})`, "group-heading"));
        const grid = node("div", null, "image-grid");
        for (const image of group.images) {
            const card = node("article", null, "screenshot-item");
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
            if (image.storage === "session") caption.append(node("span", "Retained session image", "image-meta"));
            button.append(thumbnail, caption);
            button.onclick = () => openPreview(image.id, button);
            const download = node("button", null, "download-button");
            download.type = "button";
            download.title = `Download ${image.name}`;
            download.setAttribute("aria-label", `Download ${image.name}`);
            download.disabled = image.availability !== "available";
            download.append(node("span", null, "download-icon"));
            download.firstChild.setAttribute("aria-hidden", "true");
            download.onclick = async () => {
                download.disabled = true;
                try { await saveDownload(`download/${image.id}`, image.name); }
                catch (error) { notice("download-status", `Download failed: ${error.message}`); }
                finally { download.disabled = image.availability !== "available"; }
            };
            card.append(button, download);
            grid.append(card);
        }
        section.append(grid);
        $("gallery").append(section);
    }
}

function selectSession(id) {
    if (!id || id === selected) return;
    selected = id; images = []; imageWarnings = []; collectedAt = null; page = 1;
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
            page = 1;
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
        ["Preview source", image.storage === "session" ? "Retained session image (may be resized)" : "Original file"],
        ["Location", image.path ? `${image.path}${image.storage === "session" ? " (original unavailable)" : ""}` : "No original local path"],
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
        view[key] = field.type === "checkbox" ? field.checked : key === "pageSize" ? Number(field.value) : field.value;
        if (!["sessionSearch", "thumbnail"].includes(key)) page = 1;
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
    page = 1; renderSessions(); renderGallery();
};
$("refresh").onclick = refresh;
$("session-picker").onclick = () => {
    if ($("session-options").hidden) openSessionPicker(); else closeSessionPicker();
};
$("session-picker").onkeydown = (event) => {
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        openSessionPicker(event.key === "ArrowUp");
    }
};
let pickerSearch = "", pickerSearchAt = 0;
$("session-options").onkeydown = (event) => {
    const options = [...$("session-options").children];
    const index = options.indexOf(document.activeElement);
    let next;
    if (event.key === "ArrowDown") next = Math.min(index + 1, options.length - 1);
    if (event.key === "ArrowUp") next = Math.max(index - 1, 0);
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = options.length - 1;
    if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); closeSessionPicker(true); return;
    }
    if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const now = Date.now();
        pickerSearch = `${now - pickerSearchAt > 700 ? "" : pickerSearch}${event.key.toLowerCase()}`;
        pickerSearchAt = now;
        next = options.findIndex((option) => option.textContent.trim().toLowerCase().startsWith(pickerSearch));
    }
    if (next !== undefined && next >= 0) {
        event.preventDefault();
        options[next].focus({ preventScroll: true });
        const menu = $("session-options"), option = options[next];
        if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
        if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
    }
};
document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".compact-picker")) closeSessionPicker();
});
$("session-options").addEventListener("focusout", (event) => {
    if (!event.relatedTarget?.closest(".compact-picker")) closeSessionPicker();
});
function changePage(delta) {
    page = Math.max(1, page + delta);
    renderGallery();
    $("gallery").scrollIntoView({ block: "start" });
}
async function saveDownload(route, filename, input) {
    const response = await fetch(new URL(route, location.href), input ? {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    } : {});
    if (!response.ok) {
        let message = `Request failed (${response.status}).`;
        const body = await response.text();
        try { message = JSON.parse(body).error || message; } catch { /* Keep the HTTP error for non-JSON transport failures. */ }
        throw new Error(message);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = node("a");
    link.href = url; link.download = filename; link.hidden = true;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}
$("download-all").onclick = async () => {
    const available = ordered.filter((image) => image.availability === "available");
    if (!available.length || downloadingAll) return;
    const skipped = ordered.length - available.length;
    const skippedLabel = `${skipped} unavailable image${skipped === 1 ? "" : "s"}`;
    downloadingAll = true;
    $("download-all").disabled = true;
    notice("download-status", `Preparing ${available.length} screenshots from all matching pages${skipped ? `; skipping ${skippedLabel}` : ""}...`);
    try {
        await saveDownload("api/download-all", "screenshots.zip", { ids: available.map((image) => image.id) });
        notice("download-status", `ZIP download started for ${available.length} screenshots${skipped ? `; skipped ${skippedLabel}` : ""}.`);
    } catch (error) { notice("download-status", `Download all failed: ${error.message}`); }
    finally {
        downloadingAll = false;
        $("download-all").disabled = scanning || !ordered.some((image) => image.availability === "available");
    }
};
$("page-previous").onclick = () => changePage(-1);
$("page-next").onclick = () => changePage(1);
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
