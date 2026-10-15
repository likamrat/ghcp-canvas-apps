export function tokenCount(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function contextUsage(current, limit, thresholds = DEFAULT_THRESHOLDS) {
    const used = tokenCount(current);
    const capacity = tokenCount(limit);
    if (used === null || capacity === null || capacity === 0) {
        return { used, capacity, percent: null, level: "unknown" };
    }
    const percent = used / capacity * 100;
    return { used, capacity, percent, level: percent >= thresholds.high ? "high" : percent >= thresholds.watch ? "watch" : "healthy" };
}

export function resolveParents(sessions, identities) {
    const ids = new Set(sessions.map((session) => session.id));
    const parents = new Map(sessions.map((session) => [
        session.id, identities.get(session.parentReference) ?? session.parentReference,
    ]));
    const warnings = [];
    for (const session of sessions) {
        const parent = parents.get(session.id);
        if (!parent || !ids.has(parent)) {
            parents.set(session.id, null);
            continue;
        }
        const seen = new Set([session.id]);
        let cursor = parent;
        while (cursor) {
            if (seen.has(cursor)) {
                parents.set(session.id, null);
                warnings.push("A cyclic parent link was detached so every session remains visible.");
                break;
            }
            seen.add(cursor);
            cursor = parents.get(cursor);
        }
    }
    return {
        sessions: sessions.map(({ parentReference, ...session }) => ({
            ...session, parentId: parents.get(session.id) ?? null,
        })),
        warnings: [...new Set(warnings)],
    };
}

export const SORT_PRESETS = Object.freeze({
    recent: { metric: "recent", descending: true, hint: "Recent activity first. Parents and nested sessions stay together." },
    "context-high": { metric: "used", descending: true, hint: "Most context used first. The group containing the largest context comes first." },
    "context-low": { metric: "used", descending: false, hint: "Least context used first. The group containing the smallest context comes first." },
    "percent-high": { metric: "percent", descending: true, hint: "Highest percentage used first. The group containing the highest usage comes first." },
    "percent-low": { metric: "percent", descending: false, hint: "Lowest percentage used first. The group containing the lowest usage comes first." },
    capacity: { metric: "capacity", descending: true, hint: "Largest context windows first. Parents and nested sessions stay together." },
    "name-az": { metric: "name", descending: false, hint: "A to Z, keeping each parent's nested sessions underneath it." },
    "name-za": { metric: "name", descending: true, hint: "Z to A, keeping each parent's nested sessions underneath it." },
});

export function isContextSort(sort) {
    return Object.hasOwn(SORT_PRESETS, sort) && ["used", "percent", "capacity"].includes(SORT_PRESETS[sort].metric);
}

function sortValue(session, metric) {
    if (metric === "used") return tokenCount(session.context?.used);
    if (metric === "capacity") return tokenCount(session.context?.capacity) > 0 ? session.context.capacity : null;
    if (metric === "percent") return Number.isFinite(session.context?.percent) && session.context.percent >= 0 ? session.context.percent : null;
    const timestamp = Date.parse(session.updatedAt ?? "");
    return Number.isFinite(timestamp) ? timestamp : null;
}

export function availableModels(sessions) {
    return [...new Set(sessions.filter((session) => !session.archived && typeof session.model === "string" && session.model.trim())
        .map((session) => session.model))].sort((a, b) => a.localeCompare(b));
}

export function matchesFilters(session, { search = "", onlyPinned = false, model = "", usageLevel = "", hideMissing = false } = {}) {
    const query = search.trim().toLocaleLowerCase();
    return (!onlyPinned || session.pinned === true) && (!model || session.model === model) &&
        (!usageLevel || (session.context?.level ?? "unknown") === usageLevel) &&
        (!hideMissing || (session.context?.level ?? "unknown") !== "unknown") &&
        (!query || [session.name, session.project, session.model, session.id]
            .some((value) => String(value ?? "").toLocaleLowerCase().includes(query)));
}

export function visibleTree(sessions, {
    search = "", includeArchived = false, collapsed = new Set(), sort = "recent", onlyPinned = false, model = "", usageLevel = "", hideMissing = false,
    sessionIds = null,
} = {}) {
    if (!Object.hasOwn(SORT_PRESETS, sort)) throw new Error("Choose a supported session sort order.");
    const preset = SORT_PRESETS[sort];
    const eligible = sessions.filter((session) => includeArchived || !session.archived);
    const byId = new Map(eligible.map((session) => [session.id, session]));
    const descendants = new Map();
    for (const session of eligible) {
        const seen = new Set([session.id]);
        let parent = session.parentId;
        while (parent && byId.has(parent) && !seen.has(parent)) {
            seen.add(parent);
            descendants.set(parent, (descendants.get(parent) ?? 0) + 1);
            parent = byId.get(parent).parentId;
        }
    }
    const query = search.trim().toLocaleLowerCase();
    const filterMatches = new Set(eligible.filter((session) =>
        matchesFilters(session, { search, onlyPinned, model, usageLevel, hideMissing })).map((session) => session.id));
    const matches = sessionIds ? new Set([...filterMatches].filter((id) => sessionIds.has(id))) : filterMatches;
    const included = new Set(matches);
    for (const id of matches) {
        const seen = new Set([id]);
        let parent = byId.get(id)?.parentId;
        while (parent && byId.has(parent) && !seen.has(parent)) {
            seen.add(parent);
            included.add(parent);
            parent = byId.get(parent).parentId;
        }
    }
    const scores = new Map(eligible.map((session) => [
        session.id, isContextSort(sort) && !filterMatches.has(session.id) ? null : sortValue(session, preset.metric),
    ]));
    if (isContextSort(sort)) {
        for (const session of eligible) {
            const value = scores.get(session.id);
            if (!filterMatches.has(session.id) || value === null) continue;
            const seen = new Set([session.id]);
            let parent = session.parentId;
            while (parent && byId.has(parent) && !seen.has(parent)) {
                seen.add(parent);
                const current = scores.get(parent);
                if (current === null || (preset.descending ? value > current : value < current)) scores.set(parent, value);
                parent = byId.get(parent).parentId;
            }
        }
    }
    const children = new Map();
    for (const session of eligible) {
        if (!included.has(session.id)) continue;
        const parent = byId.has(session.parentId) && included.has(session.parentId) ? session.parentId : null;
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(session);
    }
    const compare = (a, b) => {
        const direction = preset.descending ? -1 : 1;
        if (preset.metric === "name") return direction * a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
        const left = scores.get(a.id);
        const right = scores.get(b.id);
        if (left === null && right !== null) return 1;
        if (right === null && left !== null) return -1;
        return (left === null ? 0 : direction * (left - right)) ||
            String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")) ||
            a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    };
    for (const group of children.values()) group.sort(compare);
    const result = [];
    const visited = new Set();
    const stack = [...(children.get(null) ?? [])].reverse().map((session) => ({ session, depth: 0 }));
    while (stack.length) {
        const { session, depth } = stack.pop();
        if (visited.has(session.id)) continue;
        visited.add(session.id);
        const nested = children.get(session.id) ?? [];
        result.push({
            ...session, depth, childCount: nested.length,
            descendantCount: descendants.get(session.id) ?? 0, matching: matches.has(session.id),
            pageContext: sessionIds !== null && !matches.has(session.id),
        });
        if (query || onlyPinned || model || usageLevel || hideMissing || (sessionIds !== null && !matches.has(session.id)) || !collapsed.has(session.id)) {
            for (const child of [...nested].reverse()) stack.push({ session: child, depth: depth + 1 });
        }

    }
    return result;
}

export function paginateSessions(sessions, page = 1, pageSize = 8) {
    if (![8, 16, 32].includes(pageSize)) {
        throw Object.assign(new Error("Choose 8, 16, or 32 sessions per page."), { code: "invalid_input" });
    }
    if (!Number.isSafeInteger(page) || page < 1) {
        throw Object.assign(new Error("Choose a valid page."), { code: "invalid_input" });
    }
    const pages = Math.max(1, Math.ceil(sessions.length / pageSize));
    page = Math.min(page, pages);
    const offset = (page - 1) * pageSize;
    const items = sessions.slice(offset, offset + pageSize);
    return { page, pages, pageSize, sessions: items, start: items.length ? offset + 1 : 0, end: offset + items.length, matching: sessions.length };
}

export const DEFAULT_THRESHOLDS = Object.freeze({ watch: 65, high: 85 });

export function validateThresholds(thresholds) {
    if (!thresholds || !Number.isInteger(thresholds.watch) || !Number.isInteger(thresholds.high) ||
        thresholds.watch < 0 || thresholds.high > 100 || thresholds.watch >= thresholds.high) {
        throw Object.assign(new Error("Choose whole percentages from 0 to 100. The warning level must be lower than the high-usage level."), { code: "invalid_input" });
    }
    return { watch: thresholds.watch, high: thresholds.high };
}

export function buildUsageScale(thresholds, palette) {
    const { watch, high } = validateThresholds(thresholds);
    for (const key of ["low", "soft", "sage", "warning", "high", "max"]) {
        if (!/^#[\da-f]{6}$/i.test(palette?.[key])) {
            throw new Error(`Invalid context color: ${key}.`);
        }
    }
    const stops = [
        { at: 0, color: palette.low },
        ...[
            { at: watch * .35, color: palette.soft },
            { at: watch * .75, color: palette.sage },
            { at: watch, color: palette.warning },
            { at: high, color: palette.high },
        ].filter((stop) => stop.at > 0 && stop.at < 100),
        { at: 100, color: palette.max },
    ];
    return {
        stops,
        gradient: `linear-gradient(90deg in srgb, ${stops.map((stop) => `${stop.color} ${stop.at}%`).join(", ")})`,
    };
}

export function usageColor(percent, scale) {
    if (!Number.isFinite(percent) || percent < 0) return null;
    const value = Math.min(percent, 100);
    for (let index = 1; index < scale.stops.length; index++) {
        const left = scale.stops[index - 1];
        const right = scale.stops[index];
        if (value > right.at) continue;
        const fraction = (value - left.at) / (right.at - left.at);
        const channels = [1, 3, 5].map((offset) => {
            const from = Number.parseInt(left.color.slice(offset, offset + 2), 16);
            const to = Number.parseInt(right.color.slice(offset, offset + 2), 16);
            return Math.round(from + (to - from) * fraction).toString(16).padStart(2, "0");
        });
        return `#${channels.join("")}`;
    }
    return scale.stops.at(-1).color.toLowerCase();
}
