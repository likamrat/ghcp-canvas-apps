import { visibleTree, contextUsage, validateThresholds, DEFAULT_THRESHOLDS, SORT_PRESETS, isContextSort, tokenCount } from "./model.mjs";

const token = document.querySelector('meta[name="monitor-token"]').content;
const rows = document.getElementById("sessions");
const search = document.getElementById("search");
const archived = document.getElementById("archived");
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

function toggle(set, id) {
    if (set.has(id)) set.delete(id);
    else set.add(id);
}

function sessionRow(session) {
    const isParent = session.descendantCount > 0;
    const isOpen = !collapsed.has(session.id) || Boolean(search.value.trim());
    const container = element("article",
        `session${session.depth ? " is-nested" : " is-root"}${isParent ? " is-parent" : ""}${isParent && isOpen ? " is-expanded" : ""}`);
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
    ].filter(Boolean).join(" / "));
    nameBlock.append(name, hierarchyLabel, element("div", "meta", [
        session.project || (session.kind === "general_chat" ? "Chat" : "Session"),
        session.archived ? "Archived" : session.running === null ? "Status not reported" : session.running ? "Running" : "Idle",
    ].join(" / ")));
    identity.append(nameBlock);
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
        fold.disabled = Boolean(search.value.trim());
        fold.title = search.value.trim() ? "Clear search to show or hide nested sessions." : `${label} (${session.descendantCount})`;
        fold.dataset.tooltip = fold.title;
        const icon = element("span", `disclosure-icon ${isOpen ? "hide-children" : "show-children"}`);
        icon.setAttribute("aria-hidden", "true");
        fold.append(icon);
        actions.append(fold);
    }
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
    numbers.append(element("span", "percent", percent === null ? "N/A" : `${percent.toFixed(1)}%`),
        element("span", "used-label", percent === null ? "Not reported" : "used"));
    const line = element("div", "line");
    line.setAttribute("aria-hidden", "true");
    if (percent !== null) {
        const thresholds = preferences?.thresholds ?? DEFAULT_THRESHOLDS;
        line.style.setProperty("--watch", `${thresholds.watch}%`);
        line.style.setProperty("--high", `${thresholds.high}%`);
        line.style.setProperty("--usage", `${Math.min(100, Math.max(0, percent))}%`);
        line.title = `Normal below ${thresholds.watch}%, warning below ${thresholds.high}%, high usage from ${thresholds.high}%. Current usage: ${percent.toFixed(1)}%.`;
        line.append(element("span", "marker"));
    }
    const contextCount = element("div", "context-count");
    const contextText = used !== null && capacity !== null && capacity > 0
        ? `${compact(used)} of ${compact(capacity)} tokens`
        : used !== null ? `${compact(used)} used; capacity not reported`
        : capacity !== null && capacity > 0 ? `Not reported; ${compact(capacity)} capacity`
        : "Not reported";
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
    const thresholds = preferences?.thresholds ?? DEFAULT_THRESHOLDS;
    const sessions = snapshot.sessions.map((session) => ({
        ...session, context: contextUsage(session.context.used, session.context.capacity, thresholds),
    }));
    document.getElementById("legend-healthy").textContent = `Normal <${thresholds.watch}%`;
    document.getElementById("legend-watch").textContent = `Warning ${thresholds.watch} to <${thresholds.high}%`;
    document.getElementById("legend-high").textContent = `High usage ${thresholds.high}%+`;
    sortHelp.textContent = SORT_PRESETS[sortBy.value].hint;
    const active = sessions.filter((session) => archived.checked || !session.archived);
    for (const session of visibleTree(sessions, { includeArchived: archived.checked })) {
        if (session.depth === 0 && session.descendantCount && !initializedParents.has(session.id)) {
            initializedParents.add(session.id);
            if (!isContextSort(sortBy.value)) collapsed.add(session.id);
        }
    }
    const visible = visibleTree(sessions, { search: search.value, includeArchived: archived.checked, collapsed, sort: sortBy.value });
    const high = active.filter((session) => session.context.level === "high").length;
    const missing = active.filter((session) => session.context.level === "unknown").length;
    count.textContent = `${visible.length} of ${active.length} sessions shown / ${high} high usage${missing ? ` / ${missing} not reported` : ""}`;
    const fragment = document.createDocumentFragment();
    if (!visible.length) {
        const empty = element("div", "empty");
        empty.append(element("strong", "", search.value.trim() ? "No matching sessions" : "No sessions yet"),
            element("span", "", search.value.trim() ? "Try another session, project, or model." : "Start a session in the Copilot app, then refresh."));
        fragment.append(empty);
    } else {
        const groups = new Map();
        for (const session of visible) {
            const article = sessionRow(session);
            (session.depth ? groups.get(session.parentId) : fragment).append(article);
            if (session.descendantCount) {
                const children = element("div", "session-children");
                children.id = `children-${session.id}`;
                children.hidden = collapsed.has(session.id) && !search.value.trim();
                children.setAttribute("role", "group");
                children.setAttribute("aria-label", `Nested sessions under ${session.name}`);
                article.append(children);
                groups.set(session.id, children);
            }
        }
    }
    const focused = document.activeElement;
    const focusId = focused?.dataset.id;
    const focusAction = focused?.dataset.action;
    rows.replaceChildren(fragment);
    if (focusId && focusAction) {
        [...rows.querySelectorAll("button")].find((button) =>
            button.dataset.id === focusId && button.dataset.action === focusAction)?.focus({ preventScroll: true });
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
    try {
        const response = await fetch("/api/snapshot", {
            headers: { "x-monitor-token": token }, signal: AbortSignal.timeout(10000),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Local metadata is unavailable.");
        acceptSettings(data.settings);
        snapshot = data;
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
        }
    } finally {
        rows.setAttribute("aria-busy", "false");
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
search.addEventListener("input", render);
archived.addEventListener("change", render);
sortBy.addEventListener("change", () => {
    if (isContextSort(sortBy.value)) collapsed.clear();
    render();
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
load();
