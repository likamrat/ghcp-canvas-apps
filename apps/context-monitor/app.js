import { visibleTree, contextUsage, validateThresholds, DEFAULT_THRESHOLDS, SORT_PRESETS, isContextSort, tokenCount, availableModels, buildUsageScale, usageColor, paginateSessions } from "./model.mjs";

const token = document.querySelector('meta[name="monitor-token"]').content;
const rows = document.getElementById("sessions");
const heatmap = document.getElementById("heatmap");
const heatmapRegion = document.getElementById("heatmap-region");
const search = document.getElementById("search");
const archived = document.getElementById("archived");
const pinnedOnly = document.getElementById("pinned-only");
const modelFilter = document.getElementById("model-filter");
const usageFilter = document.getElementById("usage-filter");
const includeMissing = document.getElementById("include-missing");
const pageSize = document.getElementById("page-size");
const paginationRegion = document.getElementById("pagination");
const previousPage = document.getElementById("page-previous");
const nextPage = document.getElementById("page-next");
const filterStatus = document.getElementById("filter-status");
const sortBy = document.getElementById("sort-by");
const sortHelp = document.getElementById("sort-help");
const refresh = document.getElementById("refresh");
const autoRefresh = document.getElementById("auto-refresh");
const refreshStatus = document.getElementById("refresh-status");
const errorBox = document.getElementById("error");
const count = document.getElementById("count");
const sync = document.getElementById("sync");
const thresholdForm = document.getElementById("threshold-form");
const thresholdControls = document.getElementById("threshold-controls");
const amberThreshold = document.getElementById("amber-threshold");
const roseThreshold = document.getElementById("rose-threshold");
const resetThresholds = document.getElementById("reset-thresholds");
const thresholdStatus = document.getElementById("threshold-status");
const collapsed = new Set();
const expanded = new Set();
const initializedParents = new Set();
let snapshot = null;
let loading = false;
let timer;
let preferences = null;
let draftVersion = null;
let draftDirty = false;
let savingThresholds = false;
let listedModels = null;
let heatFocusId = null;
let currentGradient = null;
let page = 1;
let matchingSessions = [];
const exact = (value) => value === null ? "Not reported" : value.toLocaleString();
const compact = (value) => value === null ? "?" : new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
const levelLabel = { healthy: "Normal", watch: "Warning", high: "High usage", unknown: "Not reported" };

function scheduleRefresh() {
    clearTimeout(timer);
    const interval = Number(autoRefresh.value);
    refreshStatus.textContent = interval === 0 ? "Read-only / auto-refresh off"
        : `Read-only / refreshes every ${interval < 60000 ? `${interval / 1000}s` : `${interval / 60000}m`}`;
    if (interval > 0 && !document.hidden && !loading) timer = setTimeout(load, interval);
}

function acceptSettings(next) {
    validateThresholds(next.thresholds);
    validateThresholds(next.defaults);
    if (!preferences || next.version >= preferences.version) preferences = next;
    if (!draftDirty && !savingThresholds) {
        amberThreshold.value = String(preferences.thresholds.watch);
        roseThreshold.value = String(preferences.thresholds.high);
        draftVersion = preferences.version;
    }
    thresholdControls.disabled = savingThresholds;
}

function showThresholdStatus(message, invalid = false) {
    thresholdStatus.textContent = message;
    thresholdStatus.className = `threshold-status${invalid ? " invalid" : ""}`;
    amberThreshold.setAttribute("aria-invalid", String(invalid));
    roseThreshold.setAttribute("aria-invalid", String(invalid));
}

async function saveThresholds(reset = false) {
    if (!preferences || savingThresholds) return;
    try {
        if (!reset && (!amberThreshold.value.trim() || !roseThreshold.value.trim())) {
            throw new Error("Enter both usage levels as percentages.");
        }
        const thresholds = validateThresholds(reset ? preferences.defaults
            : { watch: Number(amberThreshold.value), high: Number(roseThreshold.value) });
        savingThresholds = true;
        thresholdControls.disabled = true;
        showThresholdStatus("Saving usage warnings...");
        const response = await fetch("/api/settings", {
            method: "POST",
            headers: { "x-monitor-token": token, "content-type": "application/json" },
            body: JSON.stringify({ ...thresholds, version: draftVersion }),
            signal: AbortSignal.timeout(10000),
        });
        const data = await response.json();
        if (!response.ok) {
            if (data.settings) {
                acceptSettings(data.settings);
                draftVersion = preferences.version;
                render();
            }
            throw new Error(data.error || "Usage warnings could not be saved.");
        }
        draftDirty = false;
        savingThresholds = false;
        acceptSettings(data);
        page = 1;
        showThresholdStatus(reset
            ? `Defaults restored: warning at ${data.defaults.watch}%, high usage at ${data.defaults.high}%.` : "Usage warnings saved.");
        render();
    } catch (error) {
        showThresholdStatus(error.message, true);
    } finally {
        savingThresholds = false;
        thresholdControls.disabled = !preferences;
    }
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function filters() {
    return { search: search.value, onlyPinned: pinnedOnly.checked, model: selectedValues(modelFilter), usageLevel: selectedValues(usageFilter), hideMissing: !includeMissing.checked };
}

const selectedValues = (control) => [...control.selectedOptions].map((option) => option.value);

function isFiltering() {
    return Boolean(search.value.trim() || pinnedOnly.checked || modelFilter.selectedOptions.length || usageFilter.selectedOptions.length);
}

function updateFilters() {
    const models = availableModels(snapshot.sessions);
    const previous = selectedValues(modelFilter);
    if (!listedModels || models.length !== listedModels.length || models.some((model, index) => model !== listedModels[index])) {
        const options = [];
        for (const model of models) {
            const option = element("option", "", model);
            option.value = model;
            option.selected = previous.includes(model);
            options.push(option);
        }
        modelFilter.replaceChildren(...options);
        listedModels = models;
    }
    modelFilter.disabled = models.length === 0;
    const removed = previous.filter((model) => !models.includes(model));
    if (removed.length) {
        page = 1;
        filterStatus.textContent = `Removed unavailable model selections: ${removed.join(", ")}.${modelFilter.selectedOptions.length ? " Other selections kept." : " Showing all models."}`;
        filterStatus.hidden = false;
    }
    pinnedOnly.disabled = snapshot.pinsAvailable !== true;
    if (pinnedOnly.disabled && pinnedOnly.checked) {
        page = 1;
        pinnedOnly.checked = false;
        filterStatus.textContent = "The pinned-only filter was turned off because app pin metadata is unavailable.";
        filterStatus.hidden = false;
    }
}

function toggle(set, id) {
    if (set.has(id)) set.delete(id);
    else set.add(id);
}

function readUsageScale() {
    const colors = getComputedStyle(document.documentElement);
    const palette = Object.fromEntries(["low", "soft", "sage", "warning", "high", "max"]
        .map((key) => [key, colors.getPropertyValue(`--usage-${key}`).trim()]));
    return buildUsageScale(preferences?.thresholds ?? DEFAULT_THRESHOLDS, palette);
}

function renderHeatmap(sessions, scale) {
    heatmapRegion.hidden = sessions.length === 0;
    document.getElementById("heatmap-count").textContent = `(${sessions.length})`;
    document.getElementById("heatmap-missing-key").hidden = !sessions.some((session) => session.context.percent === null);
    document.getElementById("heatmap-scale").style.setProperty("--usage-gradient", scale.gradient);
    if (!sessions.some((session) => session.id === heatFocusId)) heatFocusId = sessions[0]?.id ?? null;
    const fragment = document.createDocumentFragment();
    for (const session of sessions) {
        const color = usageColor(session.context.percent, scale);
        const tile = element("button", `heat-cell${color === null ? " unknown" : ""}`);
        tile.type = "button";
        tile.dataset.action = "heat-session";
        tile.dataset.id = session.id;
        tile.tabIndex = session.id === heatFocusId ? 0 : -1;
        tile.title = [
            session.name, session.model || "Model not reported",
            session.context.percent === null ? "No context data: the app has not reported a complete reading." : `${session.context.percent.toFixed(1)}% used (${levelLabel[session.context.level]})`,
        ].join("\n");
        tile.setAttribute("aria-label", tile.title.replaceAll("\n", ". "));
        if (color !== null) tile.style.setProperty("--heat-color", color);
        fragment.append(tile);
    }
    heatmap.replaceChildren(fragment);
}

function showHeatSession(id) {
    const index = matchingSessions.findIndex((session) => session.id === id);
    if (index < 0) {
        errorBox.textContent = "That session is no longer in this view. Refresh to try again.";
        errorBox.hidden = false;
        return;
    }
    page = Math.floor(index / Number(pageSize.value)) + 1;
    const byId = new Map(snapshot.sessions.map((session) => [session.id, session]));
    const seen = new Set();
    let current = byId.get(id);
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        collapsed.delete(current.id);
        current = byId.get(current.parentId);
    }
    heatFocusId = id;
    expanded.add(id);
    render();
    const target = document.getElementById(`session-${id}`);
    if (!target) {
        errorBox.textContent = "That session is no longer in this view. Refresh to try again.";
        errorBox.hidden = false;
        return;
    }
    target.scrollIntoView({ block: "center", behavior: "instant" });
    target.querySelector(".name").focus({ preventScroll: true });
}

function sessionRow(session, scale) {
    const isParent = session.descendantCount > 0;
    const isOpen = !collapsed.has(session.id) || isFiltering() || session.pageContext;
    const container = element("article",
        `session${session.depth ? " is-nested" : " is-root"}${isParent ? " is-parent" : ""}${isParent && isOpen ? " is-expanded" : ""}`);
    container.id = `session-${session.id}`;
    const row = element("div", "session-row");
    row.style.setProperty("--depth", session.depth);
    const identity = element("div", `identity${session.depth ? " nested" : ""}`);
    const nameBlock = element("div", "name-block");
    const name = element("button", "name", session.name);
    name.type = "button";
    name.title = session.name;
    name.dataset.action = "details";
    name.dataset.id = session.id;
    name.setAttribute("aria-expanded", String(expanded.has(session.id)));
    name.setAttribute("aria-controls", `details-${session.id}`);
    const hierarchy = session.depth
        ? isParent ? "Nested parent" : "Nested session"
        : isParent ? "Parent session" : "Root session";
    const hierarchyLabel = element("div", "hierarchy-label", [
        hierarchy, isParent ? `${session.descendantCount} nested` : session.depth > 1 ? `Level ${session.depth}` : null,
        session.pinned === true ? "Pinned" : null,
    ].filter(Boolean).join(" / "));
    nameBlock.append(name, hierarchyLabel, element("div", "meta", [
        session.project || (session.kind === "general_chat" ? "Chat" : "Session"),
        session.archived ? "Archived" : session.running === null ? "Status not reported" : session.running ? "Running" : "Idle",
    ].join(" / ")));
    if (!session.matching) nameBlock.append(element("div", "filter-parent",
        isFiltering() ? "Parent of matching sessions" : "Parent of sessions on this page"));
    const actions = element("div", "row-actions");
    if (isParent) {
        const fold = element("button", "fold icon-button");
        fold.type = "button";
        fold.dataset.action = "fold";
        fold.dataset.id = session.id;
        const label = `${isOpen ? "Hide" : "Show"} nested sessions`;
        fold.setAttribute("aria-label", `${label} for ${session.name}`);
        fold.setAttribute("aria-expanded", String(isOpen));
        fold.setAttribute("aria-controls", `children-${session.id}`);
        fold.disabled = isFiltering() || session.pageContext;
        fold.title = session.pageContext ? "Parent kept open for sessions on this page."
            : isFiltering() ? "Clear search and filters to show or hide nested sessions." : `${label} (${session.descendantCount})`;
        fold.dataset.tooltip = fold.title;
        const icon = element("span", `disclosure-icon ${isOpen ? "hide-children" : "show-children"}`);
        icon.setAttribute("aria-hidden", "true");
        fold.append(icon);
        identity.append(fold);
    } else identity.append(element("span", "disclosure-spacer"));
    identity.append(nameBlock);
    const modelBlock = element("div", "model-block");
    const model = element("div", "model", session.model || "Model not reported");
    model.title = session.model || "Model not reported";
    modelBlock.append(model, element("div", "model-note",
        [session.reasoningEffort, session.contextTier === "long_context" ? "Long context" : session.contextTier].filter(Boolean).join(" / ")));
    const usage = {
        input: tokenCount(session.usage?.input),
        output: tokenCount(session.usage?.output),
    };
    const totals = element("dl", "token-totals");
    for (const [label, value, explanation] of [
        ["Input total", usage.input, "Tokens the model has read across this session's requests, not the current context size."],
        ["Output total", usage.output, "Tokens the model has generated across this session's requests, not the reply limit."],
    ]) {
        const pair = element("div");
        pair.title = explanation;
        pair.append(element("dt", "", label), element("dd", "", value === null ? "Not reported" : compact(value)));
        totals.append(pair);
    }
    modelBlock.append(totals);
    const context = element("div", `context ${session.context.level}`);
    const { used, capacity, percent, level } = session.context;
    context.setAttribute("aria-label", percent === null ? "Context usage not reported"
        : `${levelLabel[level]} context: ${percent.toFixed(1)} percent, ${exact(used)} of ${exact(capacity)} tokens`);
    const numbers = element("div", "numbers");
    numbers.append(element("span", "percent", percent === null ? "N/A" : `${percent.toFixed(1)}% used`));
    if (percent === null) numbers.append(element("span", "missing-usage", "No context data"));
    const line = element("div", "line");
    line.setAttribute("aria-hidden", "true");
    if (percent !== null) {
        const thresholds = preferences?.thresholds ?? DEFAULT_THRESHOLDS;
        line.style.setProperty("--usage-gradient", scale.gradient);
        line.style.setProperty("--usage", `${Math.min(100, Math.max(0, percent))}%`);
        line.title = `Normal below ${thresholds.watch}%, warning below ${thresholds.high}%, high usage from ${thresholds.high}%. Current usage: ${percent.toFixed(1)}%.`;
        line.append(element("span", "marker"));
    }
    const contextCount = element("div", "context-count");
    const contextText = used !== null && capacity !== null && capacity > 0
        ? `${compact(used)} of ${compact(capacity)} tokens`
        : used !== null ? `${compact(used)} used; capacity unavailable`
        : capacity !== null && capacity > 0 ? `No reading; ${compact(capacity)} capacity`
        : "No context reading";
    contextCount.append(element("span", "", "Context: "),
        element("span", "tokens", contextText));
    contextCount.title = used === null || capacity === null
        ? "The app has not reported a complete context reading."
        : `${exact(used)} tokens currently in the input window, out of ${exact(capacity)} tokens of input capacity.`;
    context.append(numbers, line, contextCount);
    row.append(identity, modelBlock, context, actions);
    container.append(row);
    const details = element("div", "details");
    details.id = `details-${session.id}`;
    details.hidden = !expanded.has(session.id);
    if (!details.hidden) {
        const list = element("dl");
        for (const [label, value, explanation] of [
            ["Input total", usage.input, "Tokens read across requests in this session."],
            ["Output total", usage.output, "Tokens generated across requests in this session."],
            ["Current context", used, "Tokens currently in the model's input window."],
            ["Input window limit", capacity, "Maximum tokens the input window can hold."],
            ["Reply output limit", session.breakdown.outputLimit, "Maximum tokens the model can generate in one response."],
            ["System", session.breakdown.system, "System instructions in the current window."],
            ["Conversation", session.breakdown.conversation, "Conversation content in the current window."],
            ["Tool definitions", session.breakdown.tools, "Tool descriptions supplied to the model."],
            ["MCP tools", session.breakdown.mcp, "Reported MCP tool portion, when available."],
            ["Buffer", session.breakdown.buffer, "Reported reserved context space, when available."],
        ]) {
            const pair = element("div");
            pair.append(element("dt", "", label), element("dd", "", exact(value)),
                element("p", "metric-help", explanation));
            list.append(pair);
        }
        details.append(list, element("p", "sample", session.sampledAt
            ? `Last context sample: ${new Date(session.sampledAt).toLocaleString()}. Values are last reported, not a live token estimate.`
            : "Context sample time not reported. Values are the last saved app telemetry."),
        element("p", "sample", `Session ${session.id} / ${session.location}`));
    }
    container.append(details);
    return container;
}

function render() {
    if (!snapshot) return;
    const focused = document.activeElement;
    const focusId = focused?.dataset.id;
    const focusAction = focused?.dataset.action;
    if (focusAction === "heat-session") heatFocusId = focusId;
    const thresholds = preferences?.thresholds ?? DEFAULT_THRESHOLDS;
    const scale = readUsageScale();
    currentGradient = scale.gradient;
    const sessions = snapshot.sessions.map((session) => ({
        ...session, context: contextUsage(session.context.used, session.context.capacity, thresholds),
    }));
    document.getElementById("legend-healthy").textContent = `Normal <${thresholds.watch}%`;
    document.getElementById("legend-watch").textContent = `Warning ${thresholds.watch} to <${thresholds.high}%`;
    document.getElementById("legend-high").textContent = `High usage ${thresholds.high}%+`;
    sortHelp.textContent = SORT_PRESETS[sortBy.value].hint;
    for (const session of visibleTree(sessions, { includeArchived: archived.checked })) {
        if (session.descendantCount && !initializedParents.has(session.id)) {
            initializedParents.add(session.id);
            if (!isContextSort(sortBy.value)) collapsed.add(session.id);
        }
    }
    const matching = visibleTree(sessions, { ...filters(), includeArchived: archived.checked, sort: sortBy.value })
        .filter((session) => session.matching);
    matchingSessions = matching;
    const pagination = paginateSessions(matching, page, Number(pageSize.value));
    page = pagination.page;
    const pageIds = new Set(pagination.sessions.map((session) => session.id));
    const visible = visibleTree(sessions, { ...filters(), includeArchived: archived.checked, collapsed, sort: sortBy.value, sessionIds: pageIds });
    renderHeatmap(matching, scale);
    paginationRegion.hidden = matching.length === 0;
    document.getElementById("page-range").textContent = `${pagination.start}-${pagination.end} of ${pagination.matching} sessions`;
    document.getElementById("page-status").textContent = `Page ${pagination.page} of ${pagination.pages}`;
    previousPage.disabled = page === 1;
    nextPage.disabled = page === pagination.pages;
    const high = matching.filter((session) => session.context.level === "high").length;
    const missing = matching.filter((session) => session.context.level === "unknown").length;
    const parentsShown = visible.filter((session) => !session.matching).length;
    count.textContent = [
        parentsShown ? `${parentsShown} ${parentsShown === 1 ? "parent" : "parents"} shown for context` : "",
        high ? `${high} high usage` : "",
        missing ? `${missing} without context data` : "",
    ].filter(Boolean).join(" / ");
    count.hidden = !count.textContent;
    const fragment = document.createDocumentFragment();
    if (!visible.length) {
        const empty = element("div", "empty");
        const filtered = isFiltering() || (!includeMissing.checked && sessions.some((session) => archived.checked || !session.archived));
        empty.append(element("strong", "", filtered ? "No matching sessions" : "No sessions yet"),
            element("span", "", filtered ? "Change the filters or clear your search." : "Start a session in the Copilot app, then refresh."));
        fragment.append(empty);
    } else {
        const groups = new Map();
        for (const session of visible) {
            const article = sessionRow(session, scale);
            (session.depth ? groups.get(session.parentId) : fragment).append(article);
            if (session.descendantCount) {
                const children = element("div", "session-children");
                children.id = `children-${session.id}`;
                children.hidden = collapsed.has(session.id) && !isFiltering() && !session.pageContext;
                children.setAttribute("role", "group");
                children.setAttribute("aria-label", `Nested sessions under ${session.name}`);
                article.append(children);
                groups.set(session.id, children);
            }
        }
    }
    rows.replaceChildren(fragment);
    if (focusId && focusAction) {
        const target = [...rows.querySelectorAll("button"), ...heatmap.querySelectorAll("button")].find((button) =>
            button.dataset.id === focusId && button.dataset.action === focusAction);
        const fallback = focusAction === "heat-session" ? heatmap.querySelector("button[tabindex='0']") : null;
        (target ?? fallback)?.focus({ preventScroll: true });
    }
    const warnings = document.getElementById("warnings");
    warnings.textContent = snapshot.warnings.join(" ");
    warnings.hidden = !warnings.textContent;
}

async function load() {
    if (loading) return;
    clearTimeout(timer);
    loading = true;
    refresh.disabled = true;
    rows.setAttribute("aria-busy", "true");
    heatmap.setAttribute("aria-busy", "true");
    try {
        const response = await fetch("/api/snapshot", {
            headers: { "x-monitor-token": token }, signal: AbortSignal.timeout(10000),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Local metadata is unavailable.");
        acceptSettings(data.settings);
        snapshot = data;
        updateFilters();
        errorBox.hidden = true;
        render();
        sync.textContent = `Read at ${new Date(snapshot.collectedAt).toLocaleTimeString()} / last reported context`;
    } catch (error) {
        errorBox.textContent = `${error.message} ${snapshot ? "Showing the previous snapshot." : "Choose Refresh to retry."}`;
        errorBox.hidden = false;
        sync.textContent = snapshot ? `Stale / last successful read ${new Date(snapshot.collectedAt).toLocaleTimeString()}` : "Local metadata unavailable";
        if (!snapshot) {
            rows.replaceChildren();
            count.textContent = "Unable to load sessions";
            count.hidden = false;
        }
    } finally {
        rows.setAttribute("aria-busy", "false");
        heatmap.setAttribute("aria-busy", "false");
        loading = false;
        refresh.disabled = false;
        scheduleRefresh();
    }
}

rows.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    toggle(button.dataset.action === "fold" ? collapsed : expanded, button.dataset.id);
    render();
});
heatmap.addEventListener("click", (event) => {
    const tile = event.target.closest("button[data-action='heat-session']");
    if (tile) showHeatSession(tile.dataset.id);
});
heatmap.addEventListener("keydown", (event) => {
    const tile = event.target.closest("button[data-action='heat-session']");
    if (!tile) return;
    const buttons = [...heatmap.querySelectorAll("button")];
    const index = buttons.indexOf(tile);
    const columns = getComputedStyle(heatmap).gridTemplateColumns.split(/\s+/).length;
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
    let next;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if (Object.hasOwn(moves, event.key)) next = Math.max(0, Math.min(buttons.length - 1, index + moves[event.key]));
    else return;
    event.preventDefault();
    tile.tabIndex = -1;
    buttons[next].tabIndex = 0;
    heatFocusId = buttons[next].dataset.id;
    buttons[next].focus();
});
function resetPage() {
    page = 1;
    render();
}
function changePage(delta) {
    page = Math.max(1, page + delta);
    render();
    if (!heatmapRegion.hidden) heatmapRegion.scrollIntoView({ block: "start", behavior: "instant" });
}
search.addEventListener("input", resetPage);
archived.addEventListener("change", resetPage);
pageSize.addEventListener("change", resetPage);
previousPage.addEventListener("click", () => changePage(-1));
nextPage.addEventListener("click", () => changePage(1));
for (const control of [pinnedOnly, modelFilter, usageFilter, includeMissing]) {
    control.addEventListener("change", () => {
        if (control === usageFilter && selectedValues(usageFilter).includes("unknown")) includeMissing.checked = true;
        if (control === includeMissing && !includeMissing.checked) {
            for (const option of usageFilter.options) if (option.value === "unknown") option.selected = false;
            usageFilter.dispatchEvent(new Event("multiselect-sync"));
        }
        filterStatus.hidden = true;
        resetPage();
    });
}
sortBy.addEventListener("change", () => {
    if (isContextSort(sortBy.value)) collapsed.clear();
    resetPage();
});
refresh.addEventListener("click", load);
autoRefresh.addEventListener("change", scheduleRefresh);
thresholdForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveThresholds();
});
for (const input of [amberThreshold, roseThreshold]) {
    input.addEventListener("input", () => {
        draftDirty = true;
        showThresholdStatus("Unsaved changes.");
    });
}
resetThresholds.addEventListener("click", () => saveThresholds(true));
document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    if (!document.hidden && Number(autoRefresh.value) > 0) load();
});
window.addEventListener("pagehide", () => clearTimeout(timer));
function refreshTheme() {
    if (snapshot && readUsageScale().gradient !== currentGradient) render();
}
const themeObserver = new MutationObserver(refreshTheme);
const themeAttributes = ["data-color-mode", "data-dark-theme", "data-light-theme", "class", "style"];
themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: themeAttributes });
themeObserver.observe(document.body, { attributes: true, attributeFilter: themeAttributes });
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", refreshTheme);
load();
