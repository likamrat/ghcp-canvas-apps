import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { contextUsage, resolveParents, tokenCount, DEFAULT_THRESHOLDS, validateThresholds } from "./model.mjs";

export function databasePath(env = process.env) {
    return join(env.COPILOT_HOME || join(homedir(), ".copilot"), "data.db");
}

function sourceError(code, message) {
    return Object.assign(new Error(message), { code });
}

function schemaFor(db) {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    const schema = new Map();
    for (const table of ["sessions", "workspaces", "projects", "workspace_session_aliases", "workspace_parent_links",
        "chat_parent_links", "session_side_chats", "workspace_side_chats", "session_context_usage", "app_state"]) {
        schema.set(table, tables.has(table)
            ? new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map((row) => row.name)) : new Set());
    }
    for (const [table, required] of [
        ["sessions", ["id", "session_type", "model", "context_current_tokens", "context_input_token_limit"]],
        ["workspaces", ["id", "name", "project_id", "session_id", "creator_session_id", "archived_at"]],
    ]) {
        if (required.some((column) => !schema.get(table).has(column))) {
            throw sourceError("unsupported_schema", "This Copilot app database does not expose the required session/context fields. Update the app or the Context Monitor adapter.");
        }
    }
    return schema;
}

function readPins(db, schema) {
    const unavailable = { ids: null, warning: "Pinned-session metadata is unavailable in this app database. The pinned-only filter is disabled." };
    if (!["key", "value"].every((column) => schema.get("app_state").has(column))) return unavailable;
    const row = db.prepare("SELECT value FROM app_state WHERE key = 'sidebar-project-groups'").get();
    if (!row) return { ids: new Set(), warning: null };
    let preferences;
    try { preferences = JSON.parse(row.value); }
    catch {
        return { ids: null, warning: "Pinned-session metadata is invalid JSON. The pinned-only filter is disabled." };
    }
    const ids = preferences?.state?.pinnedWorkspaceIds;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !id)) return unavailable;
    return { ids: new Set(ids), warning: null };
}

function selectRows(db, schema, table, fields) {
    const columns = schema.get(table);
    if (!columns.size) return [];
    return db.prepare(`SELECT ${fields.map((field) => columns.has(field)
        ? `"${field}"` : `NULL AS "${field}"`).join(", ")} FROM "${table}"`).all();
}

export function readSnapshot({ path = databasePath(), now = () => new Date().toISOString(), thresholds = DEFAULT_THRESHOLDS } = {}) {
    validateThresholds(thresholds);
    if (!existsSync(path)) {
        throw sourceError("database_missing", "Copilot app data.db was not found. Run Context Monitor on the computer hosting the app; COPILOT_HOME can select its data directory.");
    }
    let db;
    try {
        db = new DatabaseSync(path, { readOnly: true });
        db.exec("PRAGMA busy_timeout = 1000; BEGIN");
        const schema = schemaFor(db);
        const rawSessions = selectRows(db, schema, "sessions", [
            "id", "title", "session_type", "model", "reasoning_effort", "context_tier",
            "is_running", "updated_at", "archived_at", "execution_location",
            "context_current_tokens", "context_input_token_limit", "context_output_token_limit",
            "context_system_tokens", "context_conversation_tokens", "context_tool_definitions_tokens",
            "context_mcp_tools_tokens", "context_buffer_tokens",
            "total_input_tokens", "total_output_tokens",
        ]);
        const workspaces = selectRows(db, schema, "workspaces", [
            "id", "name", "project_id", "session_id", "creator_session_id", "archived_at", "updated_at",
        ]);
        const aliases = selectRows(db, schema, "workspace_session_aliases", ["session_id", "workspace_id"]);
        const projects = new Map(selectRows(db, schema, "projects", ["id", "name"]).map((row) => [row.id, row.name]));
        const workspaceParents = new Map(selectRows(db, schema, "workspace_parent_links", ["child_workspace_id", "parent_workspace_id"])
            .filter((row) => row.child_workspace_id && row.parent_workspace_id)
            .map((row) => [row.child_workspace_id, row.parent_workspace_id]));
        const chats = new Map(selectRows(db, schema, "chat_parent_links", ["session_id", "parent_session_id"])
            .map((row) => [row.session_id, row.parent_session_id]));
        for (const link of selectRows(db, schema, "session_side_chats", ["session_id", "parent_session_id"])) {
            if (!chats.has(link.session_id)) chats.set(link.session_id, link.parent_session_id);
        }
        for (const link of selectRows(db, schema, "workspace_side_chats", ["session_id", "workspace_id"])) {
            if (!chats.has(link.session_id)) chats.set(link.session_id, link.workspace_id);
        }
        const byId = new Map(rawSessions.map((row) => [row.id, row]));
        const aliasesByWorkspace = new Map();
        const associated = new Set();
        for (const alias of aliases) {
            if (!aliasesByWorkspace.has(alias.workspace_id)) aliasesByWorkspace.set(alias.workspace_id, []);
            aliasesByWorkspace.get(alias.workspace_id).push(alias.session_id);
            associated.add(alias.session_id);
        }
        const identities = new Map();
        const records = [];
        for (const workspace of workspaces) {
            const candidates = [workspace.session_id, workspace.id, ...(aliasesByWorkspace.get(workspace.id) ?? [])]
                .map((id) => byId.get(id)).filter(Boolean);
            // The current binding wins; aliases are historical CLI identities, not extra app sessions.
            const session = byId.get(workspace.session_id) ?? byId.get(workspace.id) ??
                candidates.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))[0];
            for (const candidate of candidates) associated.add(candidate.id);
            const id = session?.id ?? workspace.id;
            identities.set(workspace.id, id);
            for (const alias of aliasesByWorkspace.get(workspace.id) ?? []) identities.set(alias, id);
            if (workspace.session_id) identities.set(workspace.session_id, id);
            records.push({ id, raw: session, workspace });
        }
        for (const session of rawSessions) {
            if (!associated.has(session.id) &&
                ["general_chat", "side_chat", "cli_session", "workspace"].includes(session.session_type)) {
                records.push({ id: session.id, raw: session });
                identities.set(session.id, session.id);
            }
        }
        const pins = readPins(db, schema);
        const pinnedIds = pins.ids === null ? null : new Set([...pins.ids].map((id) => identities.get(id) ?? id));
        const historySchema = schema.get("session_context_usage");
        const latestSample = ["session_id", "id", "ts_ms"].every((column) => historySchema.has(column))
            ? db.prepare("SELECT ts_ms FROM session_context_usage WHERE session_id = ? ORDER BY id DESC LIMIT 1") : null;
        const sessions = records.map(({ id, raw, workspace }) => {
            const timestamp = latestSample?.get(id)?.ts_ms;
            return {
                id,
                name: workspace?.name || raw?.title || "Untitled session",
                project: projects.get(workspace?.project_id) ?? null,
                kind: raw?.session_type ?? "project",
                parentReference: workspace ? workspaceParents.get(workspace.id) ?? workspace.creator_session_id : chats.get(id),
                model: raw?.model || null,
                reasoningEffort: raw?.reasoning_effort || null,
                contextTier: raw?.context_tier || null,
                running: raw?.is_running === 1 ? true : raw?.is_running === 0 ? false : null,
                archived: Boolean(workspace?.archived_at || raw?.archived_at),
                pinned: pinnedIds === null ? null : pinnedIds.has(id),
                location: raw?.execution_location || "local",
                updatedAt: raw?.updated_at || workspace?.updated_at || null,
                sampledAt: Number.isSafeInteger(timestamp) && timestamp >= 0 && timestamp <= 8640000000000000
                    ? new Date(timestamp).toISOString() : null,
                context: contextUsage(raw?.context_current_tokens, raw?.context_input_token_limit, thresholds),
                usage: {
                    input: tokenCount(raw?.total_input_tokens),
                    output: tokenCount(raw?.total_output_tokens),
                },
                breakdown: {
                    system: tokenCount(raw?.context_system_tokens),
                    conversation: tokenCount(raw?.context_conversation_tokens),
                    tools: tokenCount(raw?.context_tool_definitions_tokens),
                    mcp: tokenCount(raw?.context_mcp_tools_tokens),
                    buffer: tokenCount(raw?.context_buffer_tokens),
                    outputLimit: tokenCount(raw?.context_output_token_limit),
                },
            };
        });
        const resolved = resolveParents(sessions, identities);
        if (!schema.get("chat_parent_links").has("parent_session_id")) {
            resolved.warnings.push("Chat parent links are unavailable in this app database; unlinked chats appear at the root.");
        }
        if (pins.warning) resolved.warnings.push(pins.warning);
        return {
            collectedAt: now(),
            source: "Local Copilot app metadata (read-only)",
            sessions: resolved.sessions,
            pinsAvailable: pins.ids !== null,
            warnings: resolved.warnings,
        };
    } catch (error) {
        if (["database_missing", "unsupported_schema"].includes(error.code)) throw error;
        throw sourceError("database_unavailable",
            `Copilot app metadata could not be read (${error.code ?? error.name}: ${error.message}). Check permissions or retry if the database is busy.`);
    } finally {
        db?.close();
    }
}
