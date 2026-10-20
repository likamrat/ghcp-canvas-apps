export const KINDS = Object.freeze({ document: "Documents", image: "Images", diagram: "Diagrams", table: "Tables", file: "Other files" });
export const SOURCES = Object.freeze({ published: "Published", "session-file": "Session files", uploaded: "Uploaded", tool: "Tool reference", generated: "Tool-generated", unknown: "Unknown" });
export const defaultFilters = () => ({ search: "", kinds: [], sources: [], pinned: false, from: "", to: "", sort: "timestamp", order: "desc" });
const invalid = message => { throw Object.assign(new Error(message), { code: "invalid_input" }); };
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function dateBoundary(value, nextDay = false) {
    if (value === "") return null;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid("Choose a valid date.");
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (year < 100 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) invalid("Choose a valid date.");
    if (nextDay) date.setDate(date.getDate() + 1);
    return date.getTime();
}

export function queryArtifacts(records, input = {}) {
    const filters = { ...defaultFilters(), ...input };
    if (typeof filters.search !== "string" || filters.search.length > 500 || typeof filters.pinned !== "boolean" ||
        !Array.isArray(filters.kinds) || new Set(filters.kinds).size !== filters.kinds.length || !filters.kinds.every(kind => Object.hasOwn(KINDS, kind)) ||
        !Array.isArray(filters.sources) || new Set(filters.sources).size !== filters.sources.length || !filters.sources.every(source => Object.hasOwn(SOURCES, source)) ||
        !["timestamp", "name", "size"].includes(filters.sort) || !["asc", "desc"].includes(filters.order)) invalid("Choose supported artifact filters.");
    const needle = filters.search.trim().toLocaleLowerCase();
    const from = dateBoundary(filters.from), to = dateBoundary(filters.to, true);
    if (from !== null && to !== null && from >= to) invalid("From date must be on or before To date.");
    const time = row => row.timestamp && Number.isFinite(Date.parse(row.timestamp)) ? Date.parse(row.timestamp) : null;
    const value = row => filters.sort === "timestamp" ? time(row) : filters.sort === "name" ? row.name.toLocaleLowerCase() : row.size;
    return records.filter(record =>
        (!needle || `${record.title} ${record.name}`.toLocaleLowerCase().includes(needle)) &&
        (!filters.kinds.length || filters.kinds.includes(record.kind)) &&
        (!filters.sources.length || filters.sources.includes(record.source)) &&
        (!filters.pinned || record.pinned) &&
        (from === null || (time(record) !== null && time(record) >= from)) &&
        (to === null || (time(record) !== null && time(record) < to)))
        .sort((left, right) => {
            const a = value(left), b = value(right);
            if (a == null && b != null) return 1;
            if (b == null && a != null) return -1;
            return (a == null ? 0 : (filters.order === "desc" ? -1 : 1) * (typeof a === "string" ? compareText(a, b) : a - b)) || compareText(left.id, right.id);
        });
}

export function reconcileView(view, records) {
    if (![8, 16, 32].includes(view.pageSize) || !Number.isSafeInteger(view.page) || view.page < 1) invalid("Choose a supported page size and page.");
    const pages = Math.max(1, Math.ceil(records.length / view.pageSize));
    const selected = records.find(record => record.id === view.selectedId);
    return { ...view, pages, page: Math.min(view.page, pages),
        selectedId: selected?.id ?? records[0]?.id ?? null,
        revision: selected && view.revision && selected.version >= view.revision ? view.revision : null };
}

export function createRequestGate() {
    let revision = 0;
    return { next: () => ++revision, current: request => request === revision };
}

export function catalogPresentation({ phase, hasSnapshot, hasSession, total, matching }) {
    if (phase === "loading" && (!hasSnapshot || total === 0)) return "loading";
    if (phase === "error" && !hasSnapshot) return "error";
    if (!hasSession) return "idle";
    if (!hasSnapshot) return "loading";
    if (total === 0) return "empty";
    return matching ? "content" : "filtered";
}

export function sessionTree(sessions, { search = "", includeArchived = false } = {}, collapsed = new Set()) {
    const eligible = sessions.filter(session => includeArchived || !session.archived);
    const byId = new Map(eligible.map(session => [session.id, session]));
    const needle = search.trim().toLocaleLowerCase();
    const visible = new Set(eligible.filter(session =>
        `${session.name} ${session.project ?? ""} ${session.id}`.toLocaleLowerCase().includes(needle)).map(session => session.id));
    for (const id of [...visible]) {
        const seen = new Set([id]);
        let parent = byId.get(id)?.parentId;
        while (byId.has(parent) && !seen.has(parent)) {
            seen.add(parent); visible.add(parent); parent = byId.get(parent).parentId;
        }
    }
    const children = new Map();
    for (const session of eligible.filter(row => visible.has(row.id))) {
        const parent = visible.has(session.parentId) ? session.parentId : null;
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(session);
    }
    for (const group of children.values()) group.sort((a, b) =>
        compareText(b.updatedAt ?? "", a.updatedAt ?? "") || compareText(a.name, b.name) || compareText(a.id, b.id));
    const result = [], seen = new Set();
    const visit = (session, depth) => {
        if (seen.has(session.id)) return;
        seen.add(session.id);
        const nested = children.get(session.id) ?? [];
        result.push({ ...session, depth, childCount: nested.length });
        if (needle || !collapsed.has(session.id)) for (const child of nested) visit(child, depth + 1);
    };
    for (const session of children.get(null) ?? []) visit(session, 0);
    for (const session of eligible) {
        if (!visible.has(session.id) || seen.has(session.id)) continue;
        const chain = new Set();
        let cursor = session.id;
        while (byId.has(cursor) && !chain.has(cursor)) { chain.add(cursor); cursor = byId.get(cursor).parentId; }
        if (chain.has(cursor)) visit(session, 0);
    }
    return result;
}
