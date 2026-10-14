const $ = (selector) => document.querySelector(selector);
const token = $('meta[name="inbox-token"]').content;
let items = [];
let filter = "open";
let editing = null;
let busy = false;
let loading = false;
let loaded = false;
let mutationEpoch = 0;
const expandedItems = new Set();
const disclosures = new Map();
const disclosureObserver = new ResizeObserver((entries) => {
    for (const { target } of entries) updateDisclosure(target);
});

function updateDisclosure(text) {
    const disclosure = disclosures.get(text);
    if (!disclosure) return;
    const expanded = expandedItems.has(disclosure.id);
    const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight);
    disclosure.button.hidden = expanded
        ? text.scrollHeight <= lineHeight * 2 + 1
        : text.scrollHeight <= text.clientHeight + 1;
}

async function api(action, input = {}) {
    const response = await fetch("/api", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Inbox-Token": token },
        body: JSON.stringify({ action, input }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save. Try again.");
    return data;
}

function showError(error) {
    $("#error").textContent = error.message;
    $("#error").hidden = false;
}

function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
}

function copyWithSelection(text) {
    const focused = document.activeElement;
    const selection = window.getSelection();
    const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
    const buffer = node("textarea", undefined, "clipboard-buffer");
    buffer.value = text;
    buffer.readOnly = true;
    buffer.tabIndex = -1;
    buffer.setAttribute("aria-hidden", "true");
    document.body.append(buffer);
    try {
        buffer.select();
        return document.execCommand("copy");
    } finally {
        buffer.remove();
        focused?.focus({ preventScroll: true });
        if (selection) {
            selection.removeAllRanges();
            for (const range of ranges) selection.addRange(range);
        }
    }
}

async function copyText(text) {
    let cause;
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch (error) {
            cause = error;
        }
    }
    // Some embedded canvases block the Clipboard API but permit user-initiated selection copying.
    try {
        if (copyWithSelection(text)) return;
    } catch (error) {
        cause = error;
    }
    throw new Error("Could not copy to the clipboard. Expand the thought and select its text to copy manually.", { cause });
}

function confirmDeletion() {
    const dialog = $("#delete-dialog");
    dialog.returnValue = "cancel";
    return new Promise((resolve) => {
        dialog.addEventListener("close", () => resolve(dialog.returnValue === "delete"), { once: true });
        dialog.showModal();
    });
}

function render() {
    disclosureObserver.disconnect();
    disclosures.clear();
    $("#open-count").textContent = items.filter((item) => !item.done).length;
    $("#done-count").textContent = items.filter((item) => item.done).length;
    const list = $("#list");
    list.replaceChildren();
    list.setAttribute("aria-busy", "false");
    const visible = items.filter((item) => item.done === (filter === "done"));
    if (!visible.length) {
        list.append(node("p", filter === "done" ? "Finished thoughts will appear here." :
            "Nothing waiting. Add a thought above, then get back to your chat.", "empty"));
    }
    for (const item of visible) {
        const row = node("article", undefined, `item${item.done ? " done" : ""}`);
        const checkbox = node("input");
        checkbox.type = "checkbox";
        checkbox.checked = item.done;
        checkbox.disabled = busy || editing !== null;
        checkbox.setAttribute("aria-label", `${item.done ? "Reopen" : "Complete"}: ${item.text}`);
        checkbox.addEventListener("change", () => mutate("update", {
            id: item.id, version: item.version, done: checkbox.checked,
        }));
        const content = node("div");
        if (editing?.id === item.id) {
            const form = node("form");
            const label = node("label", "Edit thought");
            label.htmlFor = "edit-text";
            const textarea = node("textarea");
            textarea.id = "edit-text";
            textarea.maxLength = 4000;
            textarea.required = true;
            textarea.value = editing.text;
            textarea.addEventListener("input", () => { editing.text = textarea.value; });
            const actions = node("div", undefined, "edit-actions");
            const save = node("button", "Save");
            save.type = "submit";
            save.disabled = busy;
            const cancel = node("button", "Cancel");
            cancel.type = "button";
            cancel.disabled = busy;
            cancel.addEventListener("click", () => { editing = null; render(); });
            actions.append(save, cancel);
            form.append(label, textarea, actions);
            form.addEventListener("submit", (event) => {
                event.preventDefault();
                mutate("update", { id: item.id, version: editing.version, text: textarea.value }, () => {
                    editing = null;
                });
            });
            content.append(form);
        } else {
            const text = node("p", item.text, "thought-text");
            text.id = `thought-${item.id}`;
            const toggle = node("button", undefined, "read-more");
            toggle.type = "button";
            toggle.hidden = true;
            toggle.setAttribute("aria-controls", text.id);
            const setExpanded = () => {
                const expanded = expandedItems.has(item.id);
                text.classList.toggle("is-expanded", expanded);
                toggle.textContent = expanded ? "Show less" : "Read more";
                toggle.setAttribute("aria-expanded", String(expanded));
            };
            setExpanded();
            toggle.addEventListener("click", () => {
                if (expandedItems.has(item.id)) expandedItems.delete(item.id);
                else expandedItems.add(item.id);
                setExpanded();
                updateDisclosure(text);
            });
            disclosures.set(text, { button: toggle, id: item.id });
            content.append(text, toggle);
            const time = node("time", new Date(item.createdAt).toLocaleDateString(undefined, {
                month: "short", day: "numeric", year: "numeric",
            }));
            time.dateTime = item.createdAt;
            content.append(time);
        }
        const edit = node("button", undefined, "icon-button edit-button");
        edit.type = "button";
        edit.disabled = busy || editing !== null;
        edit.title = "Edit thought";
        edit.setAttribute("aria-label", "Edit thought");
        edit.append($("#pencil-icon").content.cloneNode(true));
        edit.addEventListener("click", () => {
            editing = { id: item.id, version: item.version, text: item.text };
            render();
            $("#edit-text").focus();
        });
        const copy = node("button", undefined, "icon-button copy-button");
        copy.type = "button";
        copy.disabled = busy || editing !== null;
        const setCopyState = (copied) => {
            const label = copied ? "Copied" : "Copy thought";
            copy.title = label;
            copy.setAttribute("aria-label", label);
            copy.replaceChildren($(`#${copied ? "check" : "copy"}-icon`).content.cloneNode(true));
        };
        setCopyState(false);
        let copying = false;
        let resetTimer;
        copy.addEventListener("click", async () => {
            if (copying) return;
            copying = true;
            clearTimeout(resetTimer);
            setCopyState(false);
            copy.setAttribute("aria-busy", "true");
            $("#copy-status").textContent = "";
            try {
                await copyText(item.text);
                setCopyState(true);
                $("#copy-status").textContent = "Thought copied to clipboard.";
                resetTimer = setTimeout(() => {
                    if (copy.isConnected) setCopyState(false);
                }, 1500);
            } catch (error) {
                showError(error);
            } finally {
                copying = false;
                copy.removeAttribute("aria-busy");
            }
        });
        const remove = node("button", undefined, "icon-button delete-button");
        remove.type = "button";
        remove.disabled = busy || editing !== null;
        remove.title = "Delete thought";
        remove.setAttribute("aria-label", "Delete thought");
        remove.append($("#trash-icon").content.cloneNode(true));
        remove.addEventListener("click", async () => {
            try {
                if (!await confirmDeletion()) return;
                await mutate("delete", { id: item.id, version: item.version }, () => {
                    expandedItems.delete(item.id);
                    queueMicrotask(() => {
                        const buttons = document.querySelectorAll(".delete-button");
                        const next = buttons[Math.min(visible.indexOf(item), buttons.length - 1)] ?? $("#idea");
                        next.focus();
                    });
                });
            } catch (error) {
                showError(error);
            }
        });
        const actions = node("div", undefined, "item-actions");
        actions.append(edit, copy, remove);
        row.append(checkbox, content, actions);
        list.append(row);
    }
    for (const text of disclosures.keys()) {
        updateDisclosure(text);
        disclosureObserver.observe(text);
    }
}

async function mutate(action, input, onSuccess = () => {}) {
    if (busy) return;
    mutationEpoch += 1;
    busy = true;
    $("#save").disabled = true;
    $("#error").hidden = true;
    render();
    try {
        const result = await api(action, input);
        items = result.items;
        loaded = true;
        onSuccess();
        $("#status").textContent = action === "delete" ? "Thought deleted." : "Saved locally. Shared across your chats.";
    } catch (error) {
        showError(error);
        $("#status").textContent = action === "delete" ? "Thought not deleted." : "Change not saved.";
    } finally {
        busy = false;
        $("#save").disabled = false;
        render();
    }
}

async function refresh() {
    if (busy || loading || editing || $("#delete-dialog").open) return;
    loading = true;
    const epoch = mutationEpoch;
    try {
        const result = await api("list");
        if (epoch !== mutationEpoch || $("#delete-dialog").open) return;
        const changed = JSON.stringify(items) !== JSON.stringify(result.items);
        items = result.items;
        if (changed || !loaded) render();
        loaded = true;
    } catch (error) {
        showError(error);
        if (!loaded) {
            $("#list").replaceChildren(node("p", "Could not load your thoughts. Use Reload to retry.", "empty"));
            $("#list").setAttribute("aria-busy", "false");
        }
    } finally {
        loading = false;
    }
}

$("#capture").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = $("#idea").value;
    mutate("add", { text }, () => {
        if ($("#idea").value === text) $("#idea").value = "";
        filter = "open";
        updateFilters();
        $("#idea").focus();
    });
});
$("#idea").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        $("#capture").requestSubmit();
    }
});
function updateFilters() {
    document.querySelectorAll("[data-filter]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.filter === filter));
    });
}
document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
        if (editing || busy) return;
        filter = button.dataset.filter;
        updateFilters();
        render();
    });
});
$("#reload").addEventListener("click", async () => {
    if (editing) {
        showError(new Error("Save or cancel your edit before reloading."));
        return;
    }
    $("#error").hidden = true;
    await refresh();
});
window.addEventListener("focus", refresh);
document.fonts.ready.then(() => {
    for (const text of disclosures.keys()) updateDisclosure(text);
});
setInterval(() => { if (!document.hidden) refresh(); }, 3000);
refresh();
