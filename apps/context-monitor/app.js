import { visibleTree } from "./model.mjs";

const token = document.querySelector('meta[name="monitor-token"]').content;
const rows = document.getElementById("sessions");
const search = document.getElementById("search");
const archived = document.getElementById("archived");
const refresh = document.getElementById("refresh");
const errorBox = document.getElementById("error");
const count = document.getElementById("count");
const sync = document.getElementById("sync");
const collapsed = new Set();
const expanded = new Set();
let snapshot = null;
let loading = false;
let timer;
const exact = (value) => value === null ? "Not reported" : value.toLocaleString();
const compact = (value) => value === null ? "?" : new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
const levelLabel = { healthy: "Healthy", watch: "Watch", high: "High", unknown: "Not reported" };

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
    const container = element("article", "session");
    const row = element("div", "session-row");
    row.style.setProperty("--depth", session.depth);
    const identity = element("div", `identity${session.depth ? " nested" : ""}`);
    if (session.childCount) {
        const fold = element("button", "fold", collapsed.has(session.id) && !search.value.trim() ? "+" : "-");
        fold.type = "button";
        fold.dataset.action = "fold";
        fold.dataset.id = session.id;
        fold.setAttribute("aria-label", `Toggle children of ${session.name}`);
        fold.setAttribute("aria-expanded", String(!collapsed.has(session.id) || Boolean(search.value.trim())));
        fold.disabled = Boolean(search.value.trim());
        identity.append(fold);
    } else identity.append(element("span", "fold-space"));
    const nameBlock = element("div", "name-block");
    const name = element("button", "name", session.name);
    name.type = "button";
    name.title = session.name;
    name.dataset.action = "details";
    name.dataset.id = session.id;
    name.setAttribute("aria-expanded", String(expanded.has(session.id)));
    name.setAttribute("aria-controls", `details-${session.id}`);
    nameBlock.append(name, element("div", "meta", [
        session.project || (session.kind === "general_chat" ? "Chat" : "Session"),
        session.archived ? "Archived" : session.running === null ? "Status not reported" : session.running ? "Running" : "Idle",
    ].join(" / ")));
    identity.append(nameBlock);
    const modelBlock = element("div", "model-block");
    const model = element("div", "model", session.model || "Model not reported");
    model.title = session.model || "Model not reported";
    modelBlock.append(model, element("div", "model-note",
        [session.reasoningEffort, session.contextTier === "long_context" ? "Long context" : session.contextTier].filter(Boolean).join(" / ")));
    const context = element("div", `context ${session.context.level}`);
    const { used, capacity, percent, level } = session.context;
    context.setAttribute("aria-label", percent === null ? "Context usage not reported"
        : `${levelLabel[level]} context: ${percent.toFixed(1)} percent, ${exact(used)} of ${exact(capacity)} tokens`);
    const numbers = element("div", "numbers");
    numbers.append(element("span", "percent", percent === null ? "N/A" : `${percent.toFixed(1)}%`),
        element("span", "tokens", `${compact(used)} / ${compact(capacity)}`));
    const line = element("div", "line");
    line.setAttribute("aria-hidden", "true");
    if (percent !== null) {
        line.style.setProperty("--usage", `${Math.min(100, Math.max(0, percent))}%`);
        line.append(element("span", "trace"), element("span", "marker"));
    }
    context.append(numbers, line);
    row.append(identity, modelBlock, context);
    container.append(row);
    const details = element("div", "details");
    details.id = `details-${session.id}`;
    details.hidden = !expanded.has(session.id);
    if (!details.hidden) {
        const list = element("dl");
        for (const [label, value] of [
            ["Current context", used], ["Input capacity", capacity], ["Output limit", session.breakdown.outputLimit],
            ["System", session.breakdown.system], ["Conversation", session.breakdown.conversation],
            ["Tool definitions", session.breakdown.tools], ["MCP tools", session.breakdown.mcp], ["Buffer", session.breakdown.buffer],
        ]) {
            const pair = element("div");
            pair.append(element("dt", "", label), element("dd", "", exact(value)));
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
    const active = snapshot.sessions.filter((session) => archived.checked || !session.archived);
    const visible = visibleTree(snapshot.sessions, { search: search.value, includeArchived: archived.checked, collapsed });
    const high = active.filter((session) => session.context.level === "high").length;
    const missing = active.filter((session) => session.context.level === "unknown").length;
    count.textContent = `${active.length} sessions / ${high} high context${missing ? ` / ${missing} not reported` : ""}`;
    const fragment = document.createDocumentFragment();
    if (!visible.length) {
        const empty = element("div", "empty");
        empty.append(element("strong", "", search.value.trim() ? "No matching sessions" : "No sessions yet"),
            element("span", "", search.value.trim() ? "Try another session, project, or model." : "Start a session in the Copilot app, then refresh."));
        fragment.append(empty);
    } else for (const session of visible) fragment.append(sessionRow(session));
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
        if (!document.hidden) timer = setTimeout(load, 5000);
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
refresh.addEventListener("click", load);
document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    if (!document.hidden) load();
});
window.addEventListener("pagehide", () => clearTimeout(timer));
load();
