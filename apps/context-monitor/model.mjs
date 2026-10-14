export function tokenCount(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function contextUsage(current, limit) {
    const used = tokenCount(current);
    const capacity = tokenCount(limit);
    if (used === null || capacity === null || capacity === 0) {
        return { used, capacity, percent: null, level: "unknown" };
    }
    const percent = used / capacity * 100;
    return { used, capacity, percent, level: percent >= 85 ? "high" : percent >= 65 ? "watch" : "healthy" };
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

export function visibleTree(sessions, { search = "", includeArchived = false, collapsed = new Set() } = {}) {
    const eligible = sessions.filter((session) => includeArchived || !session.archived);
    const byId = new Map(eligible.map((session) => [session.id, session]));
    const query = search.trim().toLocaleLowerCase();
    const matches = new Set(eligible.filter((session) =>
        !query || [session.name, session.project, session.model, session.id]
            .some((value) => String(value ?? "").toLocaleLowerCase().includes(query)),
    ).map((session) => session.id));
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
    const children = new Map();
    for (const session of eligible) {
        if (!included.has(session.id)) continue;
        const parent = byId.has(session.parentId) && included.has(session.parentId) ? session.parentId : null;
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(session);
    }
    const compare = (a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")) ||
        a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    for (const group of children.values()) group.sort(compare);
    const result = [];
    const visited = new Set();
    const stack = [...(children.get(null) ?? [])].reverse().map((session) => ({ session, depth: 0 }));
    while (stack.length) {
        const { session, depth } = stack.pop();
        if (visited.has(session.id)) continue;
        visited.add(session.id);
        const nested = children.get(session.id) ?? [];
        result.push({ ...session, depth, childCount: nested.length, matching: matches.has(session.id) });
        if (query || !collapsed.has(session.id)) {
            for (const child of [...nested].reverse()) stack.push({ session: child, depth: depth + 1 });
        }
    }
    return result;
}
