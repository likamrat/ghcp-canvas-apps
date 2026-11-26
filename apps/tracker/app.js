"use strict";

const byId = id => document.getElementById(id);
const token = document.querySelector('meta[name="tracker-token"]').content;
const pageUrl = new URL(location.href);
const boardMenu = byId("board-menu");
const boardMenuButton = byId("board-menu-button");
const statusFilter = byId("status-filter");
const toggleSubtasks = byId("toggle-subtasks");
const expandedParents = new Set();
const search = byId("search");
const rows = byId("rows");
const nameDialog = byId("name-dialog");
const sessionSearch = byId("session-search");
const sessionOptions = byId("session-options");
const itemDialog = byId("item-dialog");
const removeDialog = byId("remove-dialog");
const nameForm = byId("name-form");
const itemForm = byId("item-form");
const removeForm = byId("remove-form");
let preferredId = pageUrl.searchParams.get("board");
let boards = [], data = null, snapshot = "", revision = 0, reading = false, saving = false;
let naming, editing;

const statusTips = new Map([
    ["todo", "Work has not started."],
    ["in-progress", "Work is underway."],
    ["in-review", "Work is ready for feedback or is being reviewed."],
    ["ready-to-merge", "Review is complete and the change is ready to merge."],
    ["awaiting-deployment", "The change is merged, but is not live in the target environment yet."],
    ["blocked", "Work cannot continue until a blocker is resolved."],
    ["paused", "Work is intentionally on hold."],
    ["done", "Work is complete."],
]);

async function post(path, input) {
    const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", "x-tracker-token": token },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(12000),
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error), { code: result.code });
    return result;
}
const action = (name, input = {}) => post("/api", { action: name, input });

function showMessage(element, message) {
    element.textContent = message;
    element.hidden = !message;
}

function readableError(error) {
    return ["TimeoutError", "TypeError"].includes(error.name)
        ? "Tracker could not reach its local service. Refresh and try again."
        : error.message;
}

function setOptions(select, entries, selected) {
    select.replaceChildren(...entries.map(([id, label]) => new Option(label, id)));
    if (entries.some(([id]) => id === selected)) select.value = selected;
}

function renderBoardMenu(selected) {
    byId("board-menu-label").textContent = selected?.name ?? "Trackers";
    boardMenuButton.ariaLabel = selected ? `Trackers: ${selected.name}` : "Trackers";
    const linkSession = byId("board-session");
    linkSession.hidden = !selected;
    linkSession.textContent = selected?.sessionId ? "Change linked session" : "Link Copilot session";
    linkSession.dataset.tip = selected?.sessionId
        ? "Change or remove this tracker's session link. The tracker stays open."
        : "Associate this tracker with a Copilot session.";
    const grouped = new Map();
    for (const { id, name, sessionId, sessionName } of boards) {
        if (!grouped.has(sessionId)) {
            const group = document.createElement("div");
            const label = document.createElement("p");
            label.className = "board-group";
            label.textContent = sessionName ?? "No linked session";
            label.dataset.tip = sessionName ? `Copilot session: ${sessionName}` : "These trackers are not linked to a Copilot session.";
            group.append(label);
            grouped.set(sessionId, { group, label: label.textContent });
        }
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = name;
        button.dataset.boardId = id;
        button.dataset.tip = id === selected?.id ? "This tracker is already open." : `Open ${name}`;
        if (id === selected?.id) button.ariaCurrent = "true";
        grouped.get(sessionId).group.append(button);
    }
    const groups = [...grouped].sort(([aId, a], [bId, b]) =>
        Number(!aId) - Number(!bId) || a.label.localeCompare(b.label));
    byId("board-options").replaceChildren(...groups.map(([, { group }]) => group));
}

function positionBoardMenu(opening = false) {
    if (!opening && !boardMenu.matches(":popover-open")) return;
    if (opening) boardMenu.classList.add("measuring");
    const trigger = boardMenuButton.getBoundingClientRect();
    const below = innerHeight - trigger.bottom - 16;
    const above = trigger.top - 16;
    boardMenu.style.removeProperty("max-height");
    const openBelow = below >= boardMenu.offsetHeight || below >= above;
    boardMenu.style.maxHeight = `min(26rem, ${Math.max(0, openBelow ? below : above)}px)`;
    boardMenu.style.left = `${Math.max(12, Math.min(trigger.left, innerWidth - boardMenu.offsetWidth - 12))}px`;
    boardMenu.style.top = `${openBelow ? trigger.bottom + 5 : trigger.top - boardMenu.offsetHeight - 5}px`;
    if (opening) boardMenu.classList.remove("measuring");
}

function setBoardUrl(id) {
    if (id) pageUrl.searchParams.set("board", id);
    else pageUrl.searchParams.delete("board");
    history.replaceState(null, "", pageUrl);
}

function showWelcome(message) {
    byId("board").hidden = true;
    showMessage(byId("welcome"), message);
}

async function load({ manual = false } = {}) {
    const current = ++revision;
    const oldBoard = data?.board.id;
    reading = true;
    if (manual) byId("refresh").disabled = true;
    try {
        const { boards: available } = await action("list_boards");
        if (current !== revision) return;
        const target = available.find(board => board.id === preferredId) ?? available[0];
        const next = target ? await action("get_board", { boardId: target.id, includeDetails: true }) : null;
        if (current !== revision) return;
        const nextSnapshot = JSON.stringify([available, next]);
        preferredId = target?.id ?? null;
        setBoardUrl(preferredId);
        if (byId("error").textContent) showMessage(byId("error"), "");
        if (snapshot === nextSnapshot) return;
        snapshot = nextSnapshot;
        if (oldBoard !== target?.id || JSON.stringify(boards) !== JSON.stringify(available)) {
            boards = available;
            renderBoardMenu(target);
        }
        boardMenuButton.disabled = false;
        data = next;
        if (!data) {
            showWelcome("No trackers yet. Choose New tracker from the Trackers menu to get started.");
            return;
        }
        if (oldBoard !== target.id) {
            clearFilters();
            expandedParents.clear();
        }
        const statusOptions = [["", "All statuses"], ...data.statuses.map(({ id, label }) => [id, label])];
        if (statusOptions.length !== statusFilter.options.length || oldBoard !== target.id) {
            setOptions(statusFilter, statusOptions, statusFilter.value);
        }
        byId("board-title").textContent = data.board.name;
        showMessage(byId("board-session-name"), data.board.sessionName ? `Copilot session: ${data.board.sessionName}` : "");
        const summary = data.items.filter(item => !item.parentId);
        const count = summary.length;
        const done = summary.filter(item => item.statusId === "done").length;
        byId("board-count").textContent = `${count} ${count === 1 ? "item" : "items"} \u00b7 ${done} done`;
        byId("welcome").hidden = true;
        byId("board").hidden = false;
        renderRows();
    } catch (error) {
        if (current !== revision) return;
        preferredId = oldBoard ?? null;
        showMessage(byId("error"), readableError(error));
        if (!snapshot || byId("board").hidden) showWelcome("Could not load trackers. Use Refresh to try again.");
    } finally {
        if (current === revision) reading = false;
        if (manual) byId("refresh").disabled = false;
    }
}

function clearFilters() {
    search.value = "";
    statusFilter.value = "";
}

function row(item, status, { parent, contextOnly = false, showSubtasksColumn, subtaskCount = 0, matchingCount = subtaskCount }) {
    const tr = document.createElement("tr");
    const work = document.createElement("th");
    work.scope = "row";
    if (parent || contextOnly) {
        tr.className = parent ? "subtask-row" : "context-row";
        const context = document.createElement("span");
        context.className = "visually-hidden";
        context.textContent = parent ? `Subtask of ${parent.title}: ` : "Parent of matching subtasks: ";
        work.append(context);
    }
    const title = document.createElement("button");
    title.type = "button";
    title.className = "item-name";
    title.dataset.focus = `item-${item.id}`;
    title.textContent = item.title;
    title.addEventListener("click", () => openItem(item));
    work.append(title);
    if (item.owner || item.url) {
        const meta = document.createElement("div");
        meta.className = "item-meta";
        if (item.owner) {
            const owner = document.createElement("span");
            owner.textContent = item.owner;
            meta.append(owner);
        }
        if (item.url) {
            const link = document.createElement("a");
            link.textContent = "Source";
            link.ariaLabel = `Source for ${item.title} (opens in a new tab)`;
            link.href = item.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.dataset.focus = `source-${item.id}`;
            link.dataset.tip = "Open source in a new tab";
            meta.append(link);
        }
        work.append(meta);
    }
    if (item.note) {
        const note = document.createElement("p");
        note.className = "narrow-note item-note";
        const label = document.createElement("span");
        label.className = "visually-hidden";
        label.textContent = "Latest update: ";
        note.append(label, item.note);
        work.append(note);
    }
    const state = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "status";
    badge.dataset.tone = status.tone;
    badge.textContent = status.label;
    const tip = status.tooltip || statusTips.get(status.id) || "A custom status for this tracker.";
    badge.dataset.tip = tip;
    badge.tabIndex = 0;
    badge.dataset.focus = `status-${item.id}`;
    const description = document.createElement("span");
    description.id = `status-description-${item.id}`;
    description.hidden = true;
    description.textContent = tip;
    badge.setAttribute("aria-describedby", description.id);
    state.append(badge, description);
    const note = document.createElement("td");
    note.className = "wide-note item-note";
    note.textContent = item.note;
    tr.append(work, state, note);
    if (showSubtasksColumn) {
        const cell = document.createElement("td");
        cell.className = "subtasks-cell";
        if (subtaskCount) {
            const expanded = expandedParents.has(item.id);
            const hasPartialMatch = matchingCount > 0 && matchingCount < subtaskCount;
            const count = hasPartialMatch ? matchingCount : subtaskCount;
            const label = hasPartialMatch ? `${count} of ${subtaskCount} subtasks match`
                : `${count} ${count === 1 ? "subtask" : "subtasks"}`;
            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "subtask-toggle";
            toggle.dataset.focus = `subtasks-${item.id}`;
            toggle.dataset.tip = `${expanded ? "Hide" : "Show"} ${hasPartialMatch ? "matching subtasks" :
                `${count} ${count === 1 ? "subtask" : "subtasks"}`}`;
            toggle.ariaLabel = `${label} for ${item.title}`;
            toggle.ariaExpanded = String(expanded);
            toggle.append(byId("subtask-icon").content.cloneNode(true), String(count));
            toggle.addEventListener("click", () => {
                if (!expandedParents.delete(item.id)) expandedParents.add(item.id);
                renderRows();
            });
            cell.append(toggle);
        }
        tr.append(cell);
    }
    return tr;
}

function renderRows({ all = false } = {}) {
    if (!data) return;
    const query = search.value.trim().toLowerCase();
    const filter = statusFilter.value;
    const statuses = new Map(data.statuses.map(status => [status.id, status]));
    const matches = item => (!filter || item.statusId === filter) &&
        (!query || [item.title, item.owner, item.note].some(text => text.toLowerCase().includes(query)));
    const subtasksByParent = new Map();
    for (const item of data.items) {
        if (!item.parentId) continue;
        if (!subtasksByParent.has(item.parentId)) subtasksByParent.set(item.parentId, []);
        subtasksByParent.get(item.parentId).push(item);
    }
    for (const id of expandedParents) {
        if (!subtasksByParent.has(id)) expandedParents.delete(id);
    }
    const allWereExpanded = [...subtasksByParent.keys()].every(id => expandedParents.has(id));
    if (all) {
        if (allWereExpanded) expandedParents.clear();
        else for (const id of subtasksByParent.keys()) expandedParents.add(id);
    }
    const showSubtasksColumn = subtasksByParent.size > 0;
    const allExpanded = showSubtasksColumn && expandedParents.size === subtasksByParent.size;
    byId("subtasks-column").hidden = !showSubtasksColumn;
    toggleSubtasks.hidden = subtasksByParent.size < 2;
    toggleSubtasks.ariaExpanded = String(allExpanded);
    toggleSubtasks.textContent = allExpanded ? "Collapse all" : "Expand all";
    const focused = document.activeElement?.dataset.focus;
    const contents = document.createDocumentFragment();
    for (const item of data.items) {
        if (item.parentId) continue;
        const summaryMatches = matches(item);
        const subtasks = subtasksByParent.get(item.id) ?? [];
        const matchingSubtasks = subtasks.filter(matches);
        if (!summaryMatches && !matchingSubtasks.length) continue;
        contents.append(row(item, statuses.get(item.statusId), {
            contextOnly: !summaryMatches, showSubtasksColumn, subtaskCount: subtasks.length, matchingCount: matchingSubtasks.length,
        }));
        if (expandedParents.has(item.id)) {
            for (const subtask of matchingSubtasks) contents.append(row(subtask, statuses.get(subtask.statusId), { parent: item, showSubtasksColumn }));
        }
    }
    const shown = contents.childElementCount;
    if (tipTarget && rows.contains(tipTarget)) hideTip();
    rows.replaceChildren(contents);
    if (focused) {
        const control = [...rows.querySelectorAll("[data-focus]")].find(entry => entry.dataset.focus === focused);
        (control ?? byId("add-item")).focus({ preventScroll: true });
    }
    const count = query || filter ? `${shown} ${shown === 1 ? "row" : "rows"} shown` : "";
    if (byId("result-count").textContent !== count) byId("result-count").textContent = count;
    byId("table-wrap").hidden = !shown;
    byId("no-rows").hidden = Boolean(shown);
    if (!shown) {
        const filtered = Boolean(query || filter);
        byId("no-rows-title").textContent = filtered ? "No matching items" : "No items yet";
        byId("no-rows-detail").textContent = filtered
            ? "Try another search or clear the filters."
            : "Add a work item, or ask Copilot to add the work you want to follow.";
        byId("clear-filters").hidden = !filtered;
    }
}

function openName(kind) {
    const board = data?.board;
    const creating = kind === "board";
    const linking = kind === "session";
    const linked = linking ? board?.sessionId ?? "" : "";
    naming = { kind, boardId: board?.id, sessionId: linked, sessions: [{ id: "", label: "No session linked" }] };
    if (linked) naming.sessions.push({ id: linked, label: board.sessionName });
    const hasSessionField = creating || linking;
    const field = byId("name-input");
    const statusTip = byId("status-tip");
    byId("status-tip-field").hidden = kind !== "status";
    statusTip.disabled = kind !== "status";
    statusTip.value = "";
    byId("name-title").textContent = linking ? "Link Copilot session" : creating ? "New tracker" : "Add status";
    byId("name-label").textContent = creating ? "Tracker name" : "Status label";
    byId("name-submit").textContent = linking ? "Save session" : creating ? "Create tracker" : "Add status";
    byId("name-field").hidden = linking;
    field.disabled = linking;
    field.value = "";
    field.maxLength = creating ? 100 : 32;
    field.placeholder = creating ? "e.g. Release readiness" : "e.g. Awaiting sign-off";
    byId("session-field").hidden = !hasSessionField;
    sessionSearch.value = "";
    showMessage(byId("session-picker-status"), "");
    showMessage(nameForm.querySelector(".error"), "");
    if (hasSessionField) {
        renderSessionOptions();
        void loadSessionPicker(naming);
    }
    nameDialog.showModal();
}

function renderSessionOptions() {
    const query = sessionSearch.value.trim().toLowerCase();
    const list = document.createDocumentFragment();
    for (const { id, label } of naming.sessions) {
        if (query && !label.toLowerCase().includes(query)) continue;
        const option = document.createElement("label");
        option.className = "session-option";
        option.dataset.tip = id ? label : "Use this tracker without a linked Copilot session.";
        const input = document.createElement("input");
        input.type = "radio";
        input.className = "session-choice";
        input.name = "linked-session";
        input.value = id;
        input.checked = id === naming.sessionId;
        option.append(input, label);
        list.append(option);
    }
    if (!list.childElementCount) {
        const empty = document.createElement("p");
        empty.className = "session-option muted";
        empty.textContent = "No matching sessions.";
        list.append(empty);
    }
    sessionOptions.replaceChildren(list);
}

async function loadSessionPicker(request) {
    const status = byId("session-picker-status");
    showMessage(status, "Loading Copilot sessions...");
    try {
        const { sessions } = await action("list_sessions");
        if (naming !== request || !nameDialog.open) return;
        const duplicateNames = new Map();
        for (const { name } of sessions) duplicateNames.set(name, (duplicateNames.get(name) ?? 0) + 1);
        const options = sessions.sort((a, b) => Number(b.current) - Number(a.current)).map(({ id, name, archived, current }) => ({
            id, label: `${name}${duplicateNames.get(name) > 1 ? ` \u00b7 ${id.slice(0, 8)}` : ""}${current ? " (this session)" : archived ? " (archived)" : ""}`,
        }));
        const focused = sessionOptions.contains(document.activeElement) ? document.activeElement.value : null;
        request.sessions = [...request.sessions.filter(entry => !options.some(option => option.id === entry.id)), ...options];
        renderSessionOptions();
        if (focused !== null) [...sessionOptions.querySelectorAll("input")].find(input => input.value === focused)?.focus();
        showMessage(status, sessions.length ? "" : "No Copilot sessions found on this computer.");
    } catch (error) {
        if (naming === request && nameDialog.open) showMessage(status, readableError(error));
    }
}

function openItem(item) {
    editing = { boardId: data.board.id, item };
    byId("item-title").textContent = item ? "Edit item" : "Add item";
    byId("save-item").textContent = item ? "Save changes" : "Add item";
    byId("remove-item").hidden = !item;
    setOptions(byId("item-status"), data.statuses.map(({ id, label }) => [id, label]),
        item?.statusId ?? (statusFilter.value || "todo"));
    const parents = data.items.filter(candidate => !candidate.parentId);
    const parentField = byId("item-parent");
    parentField.disabled = Boolean(item) || !parents.length;
    byId("item-parent-field").hidden = parentField.disabled;
    setOptions(parentField, [["", "None (summary item)"], ...parents.map(({ id, title }) => [id, title])], "");
    for (const [id, value] of [["item-name", item?.title], ["item-owner", item?.owner],
        ["item-note", item?.note], ["item-url", item?.url]]) byId(id).value = value ?? "";
    showMessage(itemForm.querySelector(".error"), "");
    itemDialog.showModal();
}

function setSaving(form, value) {
    saving = value;
    form.setAttribute("aria-busy", String(value));
    for (const button of form.querySelectorAll("button")) button.disabled = value;
}

async function submit(form, run, message) {
    if (saving) return;
    const errorField = form.querySelector(".error");
    showMessage(errorField, "");
    setSaving(form, true);
    try {
        await run();
        byId("notice").textContent = message;
        await load();
    } catch (error) {
        showMessage(errorField, error.name === "TimeoutError"
            ? "Tracker did not confirm the save. Close this form and refresh before trying again."
            : readableError(error));
    } finally {
        setSaving(form, false);
    }
}

nameForm.addEventListener("submit", event => {
    event.preventDefault();
    const label = byId("name-input").value;
    const { kind, boardId, sessionId } = naming;
    void submit(nameForm, async () => {
        if (kind === "board") {
            const created = await action("create_board", { name: label, sessionId });
            preferredId = created.id;
        } else if (kind === "session") {
            if (sessionId !== (data.board.sessionId ?? "")) await action("set_board_session", { boardId, sessionId });
        } else {
            const tooltip = byId("status-tip").value.trim();
            await action("add_status", { boardId, label, ...(tooltip ? { tooltip } : {}) });
        }
        nameDialog.close();
    }, kind === "board" ? "Tracker created." : kind === "session" ? "Session saved." : "Status added.");
});

itemForm.addEventListener("submit", event => {
    event.preventDefault();
    const { boardId, item } = editing;
    const values = Object.fromEntries([...new FormData(itemForm)].map(([key, value]) => [key, value.trim()]));
    if (!values.parentId) delete values.parentId;
    void submit(itemForm, async () => {
        if (item) {
            const changes = Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== item[key]));
            if (Object.keys(changes).length) await action("update_item", { boardId, itemId: item.id, version: item.version, changes });
        } else {
            await action("add_items", { boardId, items: [values] });
            if (values.parentId) expandedParents.add(values.parentId);
        }
        itemDialog.close();
    }, item ? "Item updated." : "Item added.");
});

removeForm.addEventListener("submit", event => {
    event.preventDefault();
    const { boardId, item } = editing;
    void submit(removeForm, async () => {
        await action("remove_item", { boardId, itemId: item.id, version: item.version });
        removeDialog.close();
        itemDialog.close();
    }, "Item removed.");
});

for (const dialog of [nameDialog, itemDialog, removeDialog]) {
    dialog.addEventListener("cancel", event => { if (saving) event.preventDefault(); });
    dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
}
itemDialog.addEventListener("close", () => { if (!saving) void load(); });
function closeBoardMenu() {
    boardMenu.hidePopover();
    boardMenuButton.focus({ preventScroll: true });
}
byId("new-board").addEventListener("click", () => { closeBoardMenu(); openName("board"); });
byId("board-session").addEventListener("click", () => { closeBoardMenu(); openName("session"); });
boardMenu.addEventListener("beforetoggle", event => {
    if (event.newState === "open") positionBoardMenu(true);
    else if (tipTarget && boardMenu.contains(tipTarget)) hideTip();
});
window.addEventListener("resize", () => positionBoardMenu());
window.addEventListener("scroll", () => positionBoardMenu(), { passive: true });
sessionSearch.addEventListener("input", renderSessionOptions);
sessionOptions.addEventListener("change", event => { naming.sessionId = event.target.value; });
byId("add-status").addEventListener("click", () => openName("status"));
byId("add-item").addEventListener("click", () => openItem());
byId("remove-item").addEventListener("click", () => {
    showMessage(removeForm.querySelector(".error"), "");
    removeDialog.showModal();
});
byId("refresh").addEventListener("click", () => void load({ manual: true }));
byId("board-options").addEventListener("click", event => {
    const button = event.target.closest("[data-board-id]");
    if (!button) return;
    closeBoardMenu();
    if (button.dataset.boardId === preferredId) return;
    preferredId = button.dataset.boardId;
    void load();
});
search.addEventListener("input", renderRows);
statusFilter.addEventListener("change", renderRows);
toggleSubtasks.addEventListener("click", () => renderRows({ all: true }));
byId("clear-filters").addEventListener("click", () => {
    clearFilters();
    renderRows();
    search.focus();
});

const browserButton = byId("open-browser");
if (pageUrl.searchParams.get("view") === "browser") browserButton.hidden = true;
browserButton.addEventListener("click", async () => {
    browserButton.disabled = true;
    const status = byId("browser-status");
    try {
        await post("/api/open-browser", preferredId ? { boardId: preferredId } : {});
        showMessage(status, "Opened in your browser. Keep this Copilot session running.");
    } catch (error) {
        showMessage(status, readableError(error));
    } finally {
        browserButton.disabled = false;
    }
});

const tooltip = byId("tracker-tooltip");
const tipTrigger = target => target instanceof Element ? target.closest("[data-tip]") : null;
let tipTarget, openTipTimer, closeTipTimer, hovered, keyboardFocused;

function hideTip() {
    clearTimeout(openTipTimer);
    clearTimeout(closeTipTimer);
    openTipTimer = null;
    tooltip.hidePopover();
    tooltip.hidden = true;
    tipTarget = null;
}

function showTip(target) {
    if (tipTarget !== target) {
        hideTip();
        tipTarget = target;
    }
    clearTimeout(closeTipTimer);
    if (openTipTimer || !tooltip.hidden) return;
    openTipTimer = setTimeout(() => {
        openTipTimer = null;
        if (!target.isConnected || target.disabled) {
            hideTip();
            return;
        }
        tooltip.textContent = target.dataset.tip;
        (target.closest("dialog[open]") ?? document.body).append(tooltip);
        tooltip.hidden = false;
        tooltip.showPopover();
        const trigger = target.getBoundingClientRect();
        const { width, height } = tooltip.getBoundingClientRect();
        tooltip.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, trigger.left + (trigger.width - width) / 2))}px`;
        tooltip.style.top = `${trigger.top >= height + 12 ? trigger.top - height - 4 : trigger.bottom + 4}px`;
    }, 280);
}

function scheduleTipClose() {
    clearTimeout(openTipTimer);
    clearTimeout(closeTipTimer);
    openTipTimer = null;
    const target = tipTarget;
    closeTipTimer = setTimeout(() => {
        hideTip();
        if (keyboardFocused && keyboardFocused !== target && keyboardFocused.isConnected) showTip(keyboardFocused);
    }, 150);
}

document.addEventListener("pointerover", event => {
    if (event.pointerType === "touch") return;
    const target = tipTrigger(event.target);
    if (target && target !== hovered) {
        hovered = target;
        showTip(target);
    } else if (tooltip.contains(event.target) && !tooltip.hidden) clearTimeout(closeTipTimer);
});
document.addEventListener("pointerout", event => {
    if (event.pointerType === "touch") return;
    const target = tipTrigger(event.target);
    if (target && target !== tipTrigger(event.relatedTarget)) {
        hovered = null;
        if (target !== keyboardFocused && target === tipTarget) scheduleTipClose();
    } else if (tooltip.contains(event.target) && !tooltip.contains(event.relatedTarget) && tipTarget !== keyboardFocused) {
        scheduleTipClose();
    }
});
document.addEventListener("focusin", event => {
    const target = tipTrigger(event.target);
    if (target && event.target.matches(":focus-visible")) {
        keyboardFocused = target;
        showTip(target);
    }
});
document.addEventListener("focusout", event => {
    if (tipTrigger(event.target) === keyboardFocused && keyboardFocused) {
        keyboardFocused = null;
        if (tipTrigger(event.target) !== hovered) hideTip();
    }
});
document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || !tipTarget) return;
    if (!tooltip.hidden) event.preventDefault();
    hideTip();
});
document.addEventListener("pointerdown", hideTip);
window.addEventListener("scroll", hideTip, { passive: true });
window.addEventListener("resize", hideTip);

void load();
setInterval(() => {
    if (!document.hidden && !reading && !saving &&
        !document.querySelector("dialog[open], #board-menu:popover-open")) void load();
}, 3000);
