for (const select of document.querySelectorAll("select[data-multiselect]")) {
    const label = document.querySelector(`label[for="${select.id}"]`);
    label.id ||= `${select.id}-label`;
    const picker = document.createElement("details");
    picker.className = "multi-select";
    const trigger = document.createElement("summary");
    trigger.id = `${select.id}-trigger`;
    const caption = document.createElement("span");
    caption.id = `${select.id}-caption`;
    trigger.append(caption);
    trigger.setAttribute("aria-labelledby", `${label.id} ${caption.id}`);
    if (select.getAttribute("aria-describedby")) trigger.setAttribute("aria-describedby", select.getAttribute("aria-describedby"));
    const menu = document.createElement("div");
    menu.className = "multi-menu";
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-labelledby", label.id);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "multi-clear";
    clear.textContent = "Clear selection";
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Find options";
    search.setAttribute("aria-label", `Find ${label.textContent.toLowerCase()} options`);
    const choices = document.createElement("div");
    choices.className = "multi-choices";
    const empty = document.createElement("p");
    empty.className = "multi-empty";
    empty.textContent = "No matching options";
    menu.append(clear, search, choices, empty);
    picker.append(trigger, menu);
    select.after(picker);
    select.hidden = true;

    function filter() {
        const query = search.value.trim().toLocaleLowerCase();
        for (const row of choices.children) row.hidden = !row.textContent.toLocaleLowerCase().includes(query);
        empty.hidden = [...choices.children].some((row) => !row.hidden);
    }
    function sync() {
        const selected = [...select.selectedOptions];
        caption.textContent = selected.length === 0 ? select.dataset.multiselect
            : selected.length === 1 ? selected[0].textContent : `${selected.length} selected`;
        trigger.title = selected.length ? selected.map((option) => option.textContent).join(", ") : select.dataset.multiselect;
        trigger.setAttribute("aria-disabled", String(select.disabled));
        clear.disabled = selected.length === 0;
        for (const input of choices.querySelectorAll("input")) input.checked = [...select.options].some((option) => option.value === input.value && option.selected);
        if (select.disabled) picker.open = false;
    }
    function rebuild() {
        const focusedValue = choices.contains(document.activeElement) ? document.activeElement.value : null;
        choices.replaceChildren();
        for (const option of select.options) {
            const row = document.createElement("label");
            row.className = "check-filter multi-option";
            const input = document.createElement("input");
            input.type = "checkbox";
            input.value = option.value;
            input.disabled = option.disabled;
            row.append(input, document.createTextNode(option.textContent));
            input.addEventListener("change", () => {
                option.selected = input.checked;
                select.dispatchEvent(new Event("change", { bubbles: true }));
            });
            choices.append(row);
        }
        search.hidden = select.options.length <= 8;
        filter();
        sync();
        if (focusedValue !== null) {
            const next = [...choices.querySelectorAll("input")].find((input) => input.value === focusedValue && !input.parentElement.hidden && !input.disabled);
            (next ?? trigger).focus();
        }
    }
    clear.addEventListener("click", () => {
        for (const option of select.options) option.selected = false;
        select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    search.addEventListener("input", filter);
    select.addEventListener("change", sync);
    select.addEventListener("multiselect-sync", sync);
    label.addEventListener("click", (event) => { event.preventDefault(); trigger.focus(); });
    trigger.addEventListener("click", (event) => { if (select.disabled) event.preventDefault(); });
    picker.addEventListener("toggle", () => {
        if (picker.open) {
            for (const other of document.querySelectorAll(".multi-select[open]")) if (other !== picker) other.open = false;
        } else { search.value = ""; filter(); }
    });
    picker.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && picker.open) {
            event.preventDefault();
            picker.open = false;
            trigger.focus();
        } else if (["ArrowDown", "ArrowUp"].includes(event.key) && !select.disabled) {
            const inputs = [...choices.querySelectorAll("input")].filter((input) => !input.disabled && !input.parentElement.hidden);
            if (!inputs.length) return;
            event.preventDefault();
            picker.open = true;
            const index = inputs.indexOf(document.activeElement);
            inputs[index < 0 ? event.key === "ArrowDown" ? 0 : inputs.length - 1
                : (index + (event.key === "ArrowDown" ? 1 : -1) + inputs.length) % inputs.length].focus();
        }
    });
    document.addEventListener("click", (event) => { if (!picker.contains(event.target)) picker.open = false; });
    document.addEventListener("focusin", (event) => { if (!picker.contains(event.target)) picker.open = false; });
    new MutationObserver((changes) => {
        if (changes.some((change) => change.type === "childList")) rebuild();
        else sync();
    }).observe(select, { childList: true, attributes: true, attributeFilter: ["disabled"] });
    rebuild();
}
