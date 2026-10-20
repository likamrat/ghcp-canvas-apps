import { pickerOptions, movePickerFocus, pickerPlacement } from "./session-picker-model.mjs";

export function createSessionPicker({ onSelect }) {
    const get = id => document.getElementById(id);
    const trigger = get("session-picker"), popup = get("session-menu");
    const search = get("session-picker-search"), list = get("session-options");
    const count = get("session-picker-count"), current = get("session-picker-current"), top = get("session-picker-top");
    let sessions = [], selectedId = null, includeArchived = false, options = [], activeId = null, open = false, fingerprint = "";
    const elements = new Map();
    const navigations = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"]);
    const visible = element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length > 0;

    function close(restoreFocus = false) {
        open = false; popup.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
        search.setAttribute("aria-expanded", "false");
        search.removeAttribute("aria-activedescendant"); list.removeAttribute("aria-activedescendant");
        const target = trigger.disabled ? get("refresh") : trigger;
        if (restoreFocus && target.getClientRects().length) target.focus({ preventScroll: true });
    }
    function position() {
        if (!open) return;
        const bounds = trigger.getBoundingClientRect();
        if (!bounds.width) {
            const focused = popup.contains(document.activeElement);
            close();
            if (focused) get("session-search").focus({ preventScroll: true });
            return;
        }
        const offsetX = window.visualViewport?.offsetLeft ?? 0, offsetY = window.visualViewport?.offsetTop ?? 0;
        const rect = { left: bounds.left - offsetX, top: bounds.top - offsetY, bottom: bounds.bottom - offsetY, width: bounds.width };
        const viewport = { width: window.visualViewport?.width ?? innerWidth, height: window.visualViewport?.height ?? innerHeight };
        popup.style.width = `${pickerPlacement(rect, viewport, 480).width}px`;
        const height = popup.querySelector(".picker-head").offsetHeight +
            popup.querySelector(".picker-footer").offsetHeight + list.scrollHeight + 2;
        const placement = pickerPlacement(rect, viewport, height);
        popup.style.left = `${placement.left + offsetX}px`;
        popup.style.top = `${placement.top + offsetY}px`;
        popup.style.maxHeight = `${placement.maxHeight}px`;
    }
    function updateTop() { top.disabled = list.scrollTop <= 1; }
    function highlight() {
        for (const [id, element] of elements) {
            element.classList.toggle("is-active", id === activeId);
            element.setAttribute("aria-selected", String(id === selectedId));
        }
        const element = elements.get(activeId);
        for (const control of [search, list]) {
            if (element) control.setAttribute("aria-activedescendant", element.id);
            else control.removeAttribute("aria-activedescendant");
        }
    }
    function reveal(id, center = false) {
        const element = elements.get(id);
        if (!element) return;
        const start = element.offsetTop, end = start + element.offsetHeight;
        if (center) list.scrollTop = Math.max(0, start - (list.clientHeight - element.offsetHeight) / 2);
        else if (start < list.scrollTop) list.scrollTop = start;
        else if (end > list.scrollTop + list.clientHeight) list.scrollTop = end - list.clientHeight;
        updateTop();
    }
    function render(preservePosition = false) {
        const scroll = list.scrollTop;
        const anchor = preservePosition ? [...elements.entries()].find(([, element]) =>
            element.offsetTop + element.offsetHeight > scroll) : null;
        const offset = anchor ? scroll - anchor[1].offsetTop : 0;
        options = pickerOptions(sessions, search.value, includeArchived);
        if (!options.some(option => option.id === activeId)) {
            activeId = options[0]?.id ?? null;
        }
        const fragment = document.createDocumentFragment();
        elements.clear();
        for (const [index, option] of options.entries()) {
            const row = document.createElement("div");
            row.className = "picker-option";
            row.id = `picker-option-${encodeURIComponent(option.id)}`;
            row.dataset.pickerId = option.id;
            row.setAttribute("role", "option");
            row.setAttribute("aria-posinset", String(index + 1));
            row.setAttribute("aria-setsize", String(options.length));
            row.title = [option.name, option.description].filter(Boolean).join(" · ");
            const name = document.createElement("span");
            name.className = "picker-name"; name.textContent = option.name; row.append(name);
            if (option.description) {
                const detail = document.createElement("span");
                detail.className = "picker-description"; detail.textContent = option.description; row.append(detail);
            }
            elements.set(option.id, row); fragment.append(row);
        }
        if (!options.length) {
            const empty = document.createElement("p");
            empty.className = "picker-empty";
            empty.textContent = "No sessions match. Try a different name or project.";
            fragment.append(empty);
        }
        list.replaceChildren(fragment);
        list.tabIndex = options.length ? 0 : -1;
        count.textContent = `${options.length.toLocaleString()} ${search.value.trim() ? "matching " : ""}session${options.length === 1 ? "" : "s"}`;
        current.disabled = !sessions.some(session => session.id === selectedId && (includeArchived || !session.archived));
        highlight(); position();
        if (preservePosition) {
            const replacement = anchor && elements.get(anchor[0]);
            list.scrollTop = replacement ? replacement.offsetTop + offset : scroll;
        } else list.scrollTop = 0;
        updateTop();
        if (!options.length && document.activeElement === list) search.focus({ preventScroll: true });
    }
    function show(last = false) {
        if (trigger.disabled) return;
        open = true; popup.hidden = false; search.value = "";
        trigger.setAttribute("aria-expanded", "true"); search.setAttribute("aria-expanded", "true");
        activeId = selectedId;
        render();
        if (!elements.has(selectedId)) activeId = (last ? options.at(-1) : options[0])?.id ?? null;
        highlight(); reveal(activeId, true); search.focus({ preventScroll: true });
    }
    function choose(id) {
        if (!options.some(option => option.id === id)) return;
        close(true); onSelect(id);
    }
    trigger.addEventListener("click", () => open ? close(true) : show());
    trigger.addEventListener("keydown", event => {
        if (event.key === "Escape" && open) {
            event.preventDefault(); close(true);
        } else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault(); show(event.key === "ArrowUp");
        }
    });
    search.addEventListener("input", () => { activeId = null; render(); });
    list.addEventListener("click", event => {
        const option = event.target.closest("[data-picker-id]");
        if (option) choose(option.dataset.pickerId);
    });
    list.addEventListener("scroll", updateTop);
    top.addEventListener("click", () => {
        list.scrollTop = 0; activeId = options[0]?.id ?? null; highlight(); updateTop();
        search.focus({ preventScroll: true });
    });
    current.addEventListener("click", () => {
        search.value = ""; activeId = selectedId; render(); reveal(selectedId, true);
        search.focus({ preventScroll: true });
    });
    get("session-picker-close").addEventListener("click", () => close(true));
    popup.addEventListener("keydown", event => {
        if (!open) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
        if (event.key === "Tab") {
            const controls = [...popup.querySelectorAll("input, button, [tabindex]")].filter(visible);
            if (event.shiftKey && document.activeElement === controls[0]) {
                event.preventDefault(); close(true);
            } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
                const outside = [...document.querySelectorAll("button, input, select, textarea, a[href], [tabindex]")]
                    .filter(element => !popup.contains(element) && visible(element));
                const next = outside[outside.indexOf(trigger) + 1];
                close();
                if (next) { event.preventDefault(); next.focus(); }
            }
            return;
        }
        if (![search, list].includes(event.target)) return;
        if (event.key === "Enter" || (event.key === " " && event.target === list)) {
            event.preventDefault(); choose(activeId); return;
        }
        if (!navigations.has(event.key) || (event.target === search && ["Home", "End"].includes(event.key))) return;
        event.preventDefault();
        const rowHeight = elements.get(activeId)?.offsetHeight || 56;
        activeId = movePickerFocus(options, activeId, event.key, Math.max(1, Math.floor(list.clientHeight / rowHeight)));
        highlight(); reveal(activeId);
    });
    document.addEventListener("pointerdown", event => {
        if (open && !popup.contains(event.target) && !trigger.contains(event.target)) close();
    });
    document.addEventListener("focusin", event => {
        if (open && !popup.contains(event.target) && event.target !== trigger) close();
    });
    window.addEventListener("resize", position);
    window.addEventListener("scroll", event => {
        if (!(event.target instanceof Node) || !popup.contains(event.target)) position();
    }, true);
    window.visualViewport?.addEventListener("resize", position);
    return {
        update(input) {
            const previousSelection = selectedId;
            sessions = input.sessions; selectedId = input.selectedId; includeArchived = input.includeArchived;
            const selected = sessions.find(session => session.id === selectedId);
            const label = selected ? [selected.name, selected.project, selected.archived ? "Archived" : null].filter(Boolean).join(" · ") : "Choose a session";
            get("session-picker-value").textContent = label;
            trigger.title = label;
            trigger.disabled = !sessions.some(session => includeArchived || !session.archived);
            const nextFingerprint = JSON.stringify(sessions.map(session =>
                [session.id, session.name, session.project, session.parentId, session.archived])
                .sort((a, b) => String(a[0]).localeCompare(String(b[0])))) + includeArchived;
            if (open && (fingerprint !== nextFingerprint || previousSelection !== selectedId)) render(true);
            fingerprint = nextFingerprint;
        },
    };
}
