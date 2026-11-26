import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const safeId = (id) => typeof id === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(id);
const title = (name) => typeof name === "string" ? name.trim() : "";

export function readCopilotSessions(path = join(process.env.COPILOT_HOME || join(homedir(), ".copilot"), "data.db")) {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
        db.exec("PRAGMA busy_timeout = 1000; BEGIN");
        function read(table, required, optional) {
            const available = new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map(column => column.name));
            if (required.some(column => !available.has(column))) return null;
            return db.prepare(`SELECT ${[...required, ...optional].map(column =>
                available.has(column) ? `"${column}"` : `NULL AS "${column}"`).join(", ")} FROM "${table}"`).all();
        }
        const chats = read("sessions", ["id"], ["title", "updated_at", "archived_at"]);
        if (!chats) throw new Error("The Copilot database has no session identities.");
        const workspaces = read("workspaces", ["id"], ["name", "session_id", "updated_at", "archived_at"]) ?? [];
        const aliases = read("workspace_session_aliases", ["session_id", "workspace_id"], []) ?? [];
        const chatsById = new Map(chats.map(chat => [chat.id, chat]));
        const workspaceIds = new Set(workspaces.map(workspace => workspace.id));
        const aliasesByWorkspace = new Map();
        for (const { session_id: sessionId, workspace_id: workspaceId } of aliases) {
            if (!workspaceIds.has(workspaceId) || !safeId(sessionId)) continue;
            if (!aliasesByWorkspace.has(workspaceId)) aliasesByWorkspace.set(workspaceId, []);
            aliasesByWorkspace.get(workspaceId).push(sessionId);
        }
        const groupedIds = new Set();
        const sessions = [];
        for (const workspace of workspaces) {
            if (!safeId(workspace.id)) continue;
            const ids = [...new Set([workspace.id, workspace.session_id, ...(aliasesByWorkspace.get(workspace.id) ?? [])].filter(safeId))];
            for (const id of ids) groupedIds.add(id);
            const chat = chatsById.get(workspace.session_id) ?? chatsById.get(workspace.id);
            sessions.push({
                id: workspace.id, aliases: ids, name: title(workspace.name) || title(chat?.title) || "Untitled session",
                updatedAt: workspace.updated_at ?? chat?.updated_at, archived: Boolean(workspace.archived_at || chat?.archived_at),
            });
        }
        for (const chat of chats) {
            if (safeId(chat.id) && !groupedIds.has(chat.id)) {
                sessions.push({ id: chat.id, aliases: [chat.id], name: title(chat.title) || "Untitled session",
                    updatedAt: chat.updated_at, archived: Boolean(chat.archived_at) });
            }
        }
        return sessions.sort((a, b) => Number(a.archived) - Number(b.archived) ||
            String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")) || a.name.localeCompare(b.name));
    } finally { db.close(); }
}
