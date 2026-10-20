import { sessionTree } from "./model.mjs";

export function pickerOptions(sessions, query = "", includeArchived = false) {
    const byId = new Map(sessions.map(session => [session.id, session]));
    const needle = query.trim().toLocaleLowerCase();
    return sessionTree(sessions, { includeArchived }).map(session => {
        const parent = byId.get(session.parentId);
        const description = [session.project, parent ? `Child of ${parent.name}` : null, session.archived ? "Archived" : null]
            .filter(Boolean).join(" · ");
        return { ...session, description };
    }).filter(session => !needle || `${session.name} ${session.description} ${session.id}`.toLocaleLowerCase().includes(needle));
}

export function movePickerFocus(options, activeId, key, pageSize = 6) {
    if (!options.length) return null;
    const index = options.findIndex(option => option.id === activeId);
    const base = index < 0 ? 0 : index;
    const targets = {
        ArrowDown: index < 0 ? 0 : base + 1,
        ArrowUp: index < 0 ? options.length - 1 : base - 1,
        PageDown: base + pageSize, PageUp: base - pageSize,
        Home: 0, End: options.length - 1,
    };
    if (!Object.hasOwn(targets, key)) throw new Error("Unsupported picker navigation key.");
    return options[Math.max(0, Math.min(options.length - 1, targets[key]))].id;
}

export function pickerPlacement(rect, viewport, contentHeight) {
    const margin = 12, gap = 6;
    const width = Math.min(Math.max(280, rect.width), viewport.width - margin * 2);
    const left = Math.max(margin, Math.min(rect.left, viewport.width - margin - width));
    const below = viewport.height - rect.bottom - gap - margin;
    const above = rect.top - gap - margin;
    if (Math.max(below, above) < 160) {
        return { left, top: margin, width, maxHeight: Math.min(480, viewport.height - margin * 2) };
    }
    const down = below >= 300 || below >= above;
    const maxHeight = Math.min(480, down ? below : above, viewport.height - margin * 2);
    const height = Math.min(contentHeight, maxHeight);
    const top = down ? rect.bottom + gap : rect.top - gap - height;
    return { left, top: Math.max(margin, Math.min(top, viewport.height - margin - height)), width, maxHeight };
}
