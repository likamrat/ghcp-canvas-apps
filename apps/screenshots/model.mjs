export const SOURCE_LABELS = Object.freeze({ uploaded: "Uploaded", generated: "Tool-generated", unknown: "Unknown" });
export const defaultView = () => ({
    sessionSearch: "", includeArchived: false, includeChildren: false,
    filename: "", source: "", from: "", to: "",
    sort: "timestamp", order: "desc", group: "day", thumbnail: "medium", pageSize: 8,
});
export const clearFilters = (view) => ({ ...view, sessionSearch: "", filename: "", source: "", from: "", to: "" });
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const invalid = (message) => { throw Object.assign(new Error(message), { code: "invalid_input" }); };

function dateBoundary(value, nextDay = false) {
    if (!value) return null;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid("Choose a valid date.");
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (year < 100 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) invalid("Choose a valid date.");
    if (nextDay) date.setDate(date.getDate() + 1);
    return date.getTime();
}

export function previewScale(width, height, viewportWidth, viewportHeight) {
    if (![width, height, viewportWidth, viewportHeight].every((value) => Number.isFinite(value) && value > 0)) return null;
    return Math.min(viewportWidth / width, viewportHeight / height, 1);
}

export function nextZoom(current, factor, initial) {
    if (!Number.isFinite(initial) || initial <= 0 || !Number.isFinite(factor) || factor <= 0 ||
        (current !== null && (!Number.isFinite(current) || current <= 0))) invalid("Invalid zoom dimensions.");
    return Math.min(8, Math.max(Math.min(.01, initial / 10), (current ?? initial) * factor));
}

export function localDay(value) {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function queryImages(records, input = {}) {
    const view = { ...defaultView(), ...input };
    if (!["timestamp", "name", "size"].includes(view.sort) || !["asc", "desc"].includes(view.order) ||
        !["day", "source", "none"].includes(view.group) || !["", ...Object.keys(SOURCE_LABELS)].includes(view.source) ||
        typeof view.filename !== "string" || view.filename.length > 500) invalid("Choose supported image filters and ordering.");
    const from = dateBoundary(view.from);
    const to = dateBoundary(view.to, true);
    if (from !== null && to !== null && from >= to) invalid("From date must be on or before To date.");
    const needle = view.filename.trim().toLowerCase();
    const time = (image) => image.timestamp && Number.isFinite(Date.parse(image.timestamp)) ? Date.parse(image.timestamp) : null;
    const images = records.filter((image) => {
        const date = time(image);
        return (!needle || image.name.toLowerCase().includes(needle)) && (!view.source || image.source === view.source) &&
            (from === null || (date !== null && date >= from)) && (to === null || (date !== null && date < to));
    });
    const direction = view.order === "desc" ? -1 : 1;
    const sortValue = (image) => view.sort === "timestamp" ? time(image) : view.sort === "name" ? image.name.toLowerCase() : image.size;
    const compare = (left, right) => {
        const a = sortValue(left), b = sortValue(right);
        if (a == null && b != null) return 1;
        if (b == null && a != null) return -1;
        return (a == null ? 0 : direction * (typeof a === "string" ? compareText(a, b) : a - b)) || compareText(left.id, right.id);
    };
    const groups = new Map();
    for (const image of images) {
        const key = view.group === "none" ? "" : view.group === "source" ? image.source : time(image) === null ? "unknown" : localDay(image.timestamp);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(image);
    }
    const sorted = [...groups].sort(([a], [b]) => {
        if (a === "unknown" && b !== "unknown") return 1;
        if (b === "unknown" && a !== "unknown") return -1;
        return direction * compareText(view.group === "source" ? SOURCE_LABELS[a] : a, view.group === "source" ? SOURCE_LABELS[b] : b);
    }).map(([key, items]) => ({
        key,
        label: view.group === "none" ? "Screenshots" : view.group === "source" ? SOURCE_LABELS[key] : key === "unknown" ? "Unknown date" : key,
        images: items.sort(compare),
    }));
    return { images: sorted.flatMap((group) => group.images), groups: sorted, total: records.length };
}

export function paginateImages(query, page = 1, pageSize = 8) {
    if (![8, 16, 32].includes(pageSize)) invalid("Choose a supported page size.");
    if (!Number.isSafeInteger(page) || page < 1) invalid("Choose a valid page.");
    const pages = Math.max(1, Math.ceil(query.images.length / pageSize));
    page = Math.min(page, pages);
    const start = (page - 1) * pageSize;
    const images = query.images.slice(start, start + pageSize);
    const ids = new Set(images.map((image) => image.id));
    const groups = query.groups.map((group) => ({
        ...group, total: group.images.length, images: group.images.filter((image) => ids.has(image.id)),
    })).filter((group) => group.images.length);
    return { page, pages, pageSize, images, groups, start: images.length ? start + 1 : 0, end: start + images.length, matching: query.images.length };
}

export function sessionTree(sessions, { sessionSearch = "", includeArchived = false } = {}, collapsed = new Set()) {
    const eligible = sessions.filter((session) => includeArchived || !session.archived);
    const byId = new Map(eligible.map((session) => [session.id, session]));
    const search = sessionSearch.trim().toLowerCase();
    const matching = new Set(eligible.filter((session) => [session.name, session.project, session.id].some((value) => String(value ?? "").toLowerCase().includes(search))).map((session) => session.id));
    const visible = new Set(matching);
    for (const session of eligible.filter((row) => matching.has(row.id))) {
        let parent = session.parentId;
        const seen = new Set([session.id]);
        while (byId.has(parent) && !seen.has(parent)) {
            seen.add(parent); visible.add(parent); parent = byId.get(parent).parentId;
        }
    }
    const children = new Map();
    for (const session of eligible.filter((row) => visible.has(row.id))) {
        const parent = visible.has(session.parentId) ? session.parentId : null;
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(session);
    }
    for (const group of children.values()) group.sort((a, b) =>
        compareText(b.updatedAt ?? "", a.updatedAt ?? "") || compareText(a.name, b.name) || compareText(a.id, b.id));
    const result = [];
    const stack = (children.get(null) ?? []).map((session) => ({ session, depth: 0 })).reverse();
    const seen = new Set();
    while (stack.length) {
        const { session, depth } = stack.pop();
        if (seen.has(session.id)) continue;
        seen.add(session.id);
        const nested = children.get(session.id) ?? [];
        result.push({ ...session, depth, childCount: nested.length, matching: matching.has(session.id) });
        if (search || !collapsed.has(session.id)) stack.push(...nested.map((child) => ({ session: child, depth: depth + 1 })).reverse());
    }
    // Only orphaned cycles need recovery; collapsed descendants stay hidden.
    for (const session of eligible) {
        if (!visible.has(session.id) || seen.has(session.id)) continue;
        const chain = new Set();
        let cursor = session.id;
        while (byId.has(cursor) && !chain.has(cursor)) { chain.add(cursor); cursor = byId.get(cursor).parentId; }
        if (chain.has(cursor)) result.push({ ...session, depth: 0, childCount: 0 });
    }
    return result;
}

export function createRequestGate() {
    let revision = 0;
    return { next: () => ++revision, current: (request) => request === revision };
}

export const querySchema = {
    type: "object", additionalProperties: false, required: ["sessionId"],
    properties: {
        sessionId: { type: "string", minLength: 1, maxLength: 128 },
        includeChildren: { type: "boolean" }, includeArchived: { type: "boolean" },
        filename: { type: "string", maxLength: 500 },
        source: { enum: ["", "uploaded", "generated", "unknown"] },
        from: { type: "string", maxLength: 10 }, to: { type: "string", maxLength: 10 },
        sort: { enum: ["timestamp", "name", "size"] }, order: { enum: ["asc", "desc"] }, group: { enum: ["day", "source", "none"] },
        offset: { type: "integer", minimum: 0, maximum: 10000 }, limit: { type: "integer", minimum: 1, maximum: 120 },
    },
};
