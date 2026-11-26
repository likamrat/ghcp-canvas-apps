import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readCopilotSessions } from "./sessions.mjs";

const text = (maxLength, minLength = 1) => ({ type: "string", minLength, maxLength });
const object = (properties, required = Object.keys(properties)) =>
    ({ type: "object", properties, required, additionalProperties: false });
const boardId = text(64);
const itemId = text(64);
const boardName = text(100);
const sessionId = text(128, 0);
const version = { type: "integer", minimum: 1 };
const boardKey = object({ boardId });
const fields = { title: text(160), statusId: text(64), owner: text(100, 0), note: text(2000, 0), url: text(2048, 0) };
const itemKey = { boardId, itemId, version };
export const openSchema = { ...object({ boardId, boardName }, []), maxProperties: 1 };
export const actions = {
    list_boards: ["Find named trackers saved on this computer.", object({})],
    create_board: ["Create a named tracker. Optionally link a Copilot session by ID from list_sessions.", object({
        name: boardName, sessionId,
    }, ["name"])],
    list_sessions: ["List local Copilot session names and IDs available to link to a tracker.", object({})],
    set_board_session: ["Set the linked Copilot session by ID on user request. Use an empty sessionId to unlink.", object({ boardId, sessionId })],
    get_board: ["Read a tracker's summary items, status IDs, and current item versions. Set includeDetails to true only when drill-down is needed.", object({
        boardId, includeDetails: { type: "boolean" },
    }, ["boardId"])],
    add_status: ["Add a filterable status to this tracker, optionally with a hover tip explaining when to use it.", object({
        boardId, label: text(32), tooltip: text(200, 0),
    }, ["boardId", "label"])],
    add_items: ["Add work items at summary level by default. Supply parentId only for an explicitly wanted detail under a summary item. Use status IDs from get_board.", object({
        boardId,
        items: { type: "array", minItems: 1, maxItems: 50, items: object({ ...fields, parentId: itemId }, ["title"]) },
    })],
    update_item: ["Patch one item using its current version from get_board. Send only changed fields; never retry a conflict without rereading.", object({
        ...itemKey, changes: { ...object({ ...fields, hidden: { type: "boolean" } }, []), minProperties: 1 },
    })],
    remove_item: ["Permanently remove one item only on explicit user request. Use the current item version from get_board.", object(itemKey)],
};

const defaults = [
    ["todo", "To do", "neutral"], ["in-progress", "In progress", "blue"],
    ["in-review", "In review", "purple"],
    ["packaged", "Packaged", "blue", "A package was built and checked. That does not mean it was merged or deployed."],
    ["ready-to-merge", "Ready to merge", "teal"],
    ["awaiting-deployment", "Awaiting deployment", "amber"],
    ["verified-live", "Verified live", "green", "The deployment was verified in the target environment."],
    ["blocked", "Blocked", "red"], ["paused", "Paused", "amber"], ["done", "Done", "green"],
];

export class TrackerError extends Error {
    constructor(code, message, status) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

function invalid(message) {
    throw new TrackerError("invalid_input", message, 400);
}

function validate(schema, value, field = "Input") {
    switch (schema.type) {
        case "object": {
            if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${field} must be an object.`);
            const keys = Object.keys(value);
            if (keys.length < (schema.minProperties ?? 0) || keys.length > (schema.maxProperties ?? Infinity)) {
                invalid(`${field} has the wrong number of fields.`);
            }
            for (const key of schema.required) {
                if (!Object.hasOwn(value, key)) invalid(`${key} is required.`);
            }
            return Object.fromEntries(keys.map(key => {
                if (!Object.hasOwn(schema.properties, key)) invalid(`Unexpected field: ${key}.`);
                return [key, validate(schema.properties[key], value[key], key)];
            }));
        }
        case "array":
            if (!Array.isArray(value) || value.length < schema.minItems || value.length > schema.maxItems) {
                invalid(`${field} must contain between ${schema.minItems} and ${schema.maxItems} entries.`);
            }
            return value.map(entry => validate(schema.items, entry, field));
        case "string": {
            if (typeof value !== "string") invalid(`${field} must be text.`);
            const trimmed = value.trim();
            if (trimmed.length < schema.minLength || value.length > schema.maxLength || trimmed.includes("\0")) {
                invalid(`${field} must be between ${schema.minLength} and ${schema.maxLength} characters without null characters.`);
            }
            return trimmed;
        }
        case "integer":
            if (!Number.isSafeInteger(value) || value < schema.minimum) invalid(`${field} must be a positive integer.`);
            return value;
        case "boolean":
            if (typeof value !== "boolean") invalid(`${field} must be true or false.`);
            return value;
        default:
            throw new Error(`Unsupported Tracker schema type: ${schema.type}`);
    }
}

const nameKey = (name) => name.normalize("NFC").toLowerCase();
const defaultStatuses = new Map(defaults.map(([, label, tone, tooltip], index) =>
    [nameKey(label), { tone, tooltip, index }]));

function builtInStatus(status) {
    return defaultStatuses.get(nameKey(status.label));
}

function validateUrl(url) {
    if (!url) return;
    const parsed = URL.parse(url);
    if (!parsed || !["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) {
        invalid("Use an HTTP or HTTPS link without credentials.");
    }
}

export function createStore(path = join(
    process.env.COPILOT_HOME || join(homedir(), ".copilot"),
    "extensions", "tracker-data", "artifacts", "tracker.sqlite",
), { readSessions = readCopilotSessions } = {}) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS boards (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, nameKey TEXT NOT NULL UNIQUE, createdAt TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS statuses (
            boardId TEXT NOT NULL REFERENCES boards(id), id TEXT NOT NULL, label TEXT NOT NULL,
            labelKey TEXT NOT NULL, tone TEXT NOT NULL,
            PRIMARY KEY (boardId, id), UNIQUE (boardId, labelKey)
        );
        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY, boardId TEXT NOT NULL, statusId TEXT NOT NULL,
            title TEXT NOT NULL, owner TEXT NOT NULL, note TEXT NOT NULL, url TEXT NOT NULL,
            createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (boardId, statusId) REFERENCES statuses(boardId, id)
        );
        CREATE INDEX IF NOT EXISTS items_by_board ON items(boardId);
    `);

    function transaction(mode, run) {
        db.exec(mode);
        try {
            const result = run();
            db.exec("COMMIT");
            return result;
        } catch (error) {
            db.exec("ROLLBACK");
            throw error;
        }
    }

    transaction("BEGIN IMMEDIATE", () => {
        const columns = db.prepare("PRAGMA table_info(items)").all();
        if (!columns.some(column => column.name === "parentId")) {
            db.exec("ALTER TABLE items ADD COLUMN parentId TEXT REFERENCES items(id) ON DELETE RESTRICT");
        }
        if (!columns.some(column => column.name === "hidden")) {
            db.exec("ALTER TABLE items ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1))");
        }
        db.exec("CREATE INDEX IF NOT EXISTS items_by_parent ON items(parentId)");
        const boardColumns = db.prepare("PRAGMA table_info(boards)").all();
        if (!boardColumns.some(column => column.name === "sessionId")) {
            db.exec("ALTER TABLE boards ADD COLUMN sessionId TEXT; ALTER TABLE boards ADD COLUMN sessionName TEXT");
        }
        if (!db.prepare("PRAGMA table_info(statuses)").all().some(column => column.name === "tooltip")) {
            db.exec("ALTER TABLE statuses ADD COLUMN tooltip TEXT");
        }
        const backfillStatus = db.prepare(`
            INSERT INTO statuses (boardId, id, label, labelKey, tone, tooltip)
            SELECT id, ?, ?, ?, ?, ? FROM boards WHERE true ON CONFLICT DO NOTHING
        `);
        for (const [id, label, tone, tooltip = null] of defaults) backfillStatus.run(id, label, nameKey(label), tone, tooltip);
    });

    function sessions() {
        try {
            return readSessions();
        } catch (error) {
            console.error("Tracker session metadata:", error.message);
            throw new TrackerError("copilot_sessions_unavailable",
                "Copilot sessions are unavailable right now. You can still use a tracker without a linked session.", 503);
        }
    }

    function resolveSession(id) {
        if (!id) return [null, null];
        const session = sessions().find(entry => entry.id === id || entry.aliases.includes(id));
        if (!session) throw new TrackerError("copilot_session_not_found", "That Copilot session was not found. Reopen the picker and choose another session.", 404);
        return [session.id, session.name];
    }

    function requireBoard(id) {
        const board = db.prepare("SELECT id, name, sessionId, sessionName FROM boards WHERE id = ?").get(id);
        if (!board) throw new TrackerError("board_not_found", "Tracker not found. Choose an existing tracker.", 404);
        return board;
    }

    function requireStatus(id, statusId) {
        if (!db.prepare("SELECT 1 FROM statuses WHERE boardId = ? AND id = ?").get(id, statusId)) {
            invalid("Choose a status from this tracker.");
        }
    }

    const insertStatus = db.prepare("INSERT INTO statuses (boardId, id, label, labelKey, tone, tooltip) VALUES (?, ?, ?, ?, ?, ?)");
    const listBoards = db.prepare("SELECT id, name, sessionId, sessionName FROM boards ORDER BY name COLLATE NOCASE, id");
    const readItem = db.prepare("SELECT * FROM items WHERE id = ?");
    const formatItem = (item) => ({ ...item, hidden: Boolean(item.hidden) });
    const changed = () => new TrackerError("item_changed",
        "This item changed or was removed in another chat. Reopen it before trying again.", 409);

    return {
        close: () => db.close(),
        deleteBoard(raw) {
            const { boardId } = validate(boardKey, raw);
            return transaction("BEGIN IMMEDIATE", () => {
                requireBoard(boardId);
                db.prepare("DELETE FROM items WHERE boardId = ? AND parentId IS NOT NULL").run(boardId);
                db.prepare("DELETE FROM items WHERE boardId = ?").run(boardId);
                db.prepare("DELETE FROM statuses WHERE boardId = ?").run(boardId);
                db.prepare("DELETE FROM boards WHERE id = ?").run(boardId);
                return { id: boardId };
            });
        },
        resolveOpen(input = {}) {
            const { boardId, boardName } = validate(openSchema, input);
            if (boardId) return requireBoard(boardId);
            if (!boardName) return null;
            const board = db.prepare("SELECT id, name FROM boards WHERE nameKey = ?").get(nameKey(boardName));
            if (!board) throw new TrackerError("board_not_found", "No tracker has that name. Use list_boards to find it.", 404);
            return board;
        },
        run(name, raw = {}, currentSessionId) {
            if (!Object.hasOwn(actions, name)) invalid("Unknown Tracker action.");
            const input = validate(actions[name][1], raw);
            const now = new Date().toISOString();
            switch (name) {
                case "list_boards":
                    return { boards: listBoards.all() };
                case "list_sessions":
                    return { sessions: sessions().map(({ id, name, aliases, archived }) => ({
                        id, name, archived, current: aliases.includes(currentSessionId),
                    })) };
                case "set_board_session": {
                    requireBoard(input.boardId);
                    const link = resolveSession(input.sessionId);
                    db.prepare("UPDATE boards SET sessionId = ?, sessionName = ? WHERE id = ?").run(...link, input.boardId);
                    return requireBoard(input.boardId);
                }
                case "create_board": {
                    const link = resolveSession(input.sessionId);
                    return transaction("BEGIN IMMEDIATE", () => {
                        const id = randomUUID();
                        const { name } = input;
                        const result = db.prepare(`INSERT INTO boards (id, name, nameKey, createdAt, sessionId, sessionName)
                            VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(nameKey) DO NOTHING`)
                            .run(id, name, nameKey(name), now, ...link);
                        if (!result.changes) throw new TrackerError("duplicate_board", "A tracker with that name already exists.", 409);
                        for (const [statusId, label, tone, tooltip = null] of defaults) {
                            insertStatus.run(id, statusId, label, nameKey(label), tone, tooltip);
                        }
                        return requireBoard(id);
                    });
                }
                case "get_board":
                    return transaction("BEGIN", () => ({
                        board: requireBoard(input.boardId),
                        statuses: db.prepare("SELECT id, label, tone, tooltip FROM statuses WHERE boardId = ? ORDER BY rowid").all(input.boardId)
                            .sort((a, b) => (builtInStatus(a)?.index ?? defaults.length) - (builtInStatus(b)?.index ?? defaults.length))
                            .map(status => {
                                const builtin = builtInStatus(status);
                                return builtin ? { ...status, tone: builtin.tone, tooltip: status.tooltip ?? builtin.tooltip ?? null } : status;
                            }),
                        items: db.prepare(input.includeDetails
                            ? "SELECT * FROM items WHERE boardId = ? ORDER BY rowid"
                            : "SELECT * FROM items WHERE boardId = ? AND parentId IS NULL ORDER BY rowid").all(input.boardId).map(formatItem),
                    }));
                case "add_status": {
                    const { boardId, label, tooltip } = input;
                    requireBoard(boardId);
                    const id = randomUUID();
                    const result = db.prepare(`INSERT INTO statuses (boardId, id, label, labelKey, tone, tooltip)
                        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(boardId, labelKey) DO NOTHING`)
                        .run(boardId, id, label, nameKey(label), "neutral", tooltip || null);
                    if (!result.changes) throw new TrackerError("duplicate_status", "That status already exists on this tracker.", 409);
                    return { id, label, tone: "neutral", tooltip: tooltip || null };
                }
                case "add_items":
                    return transaction("BEGIN IMMEDIATE", () => {
                        const { boardId, items } = input;
                        requireBoard(boardId);
                        const insert = db.prepare(`
                            INSERT INTO items (id, boardId, statusId, title, owner, note, url, createdAt, updatedAt, parentId)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `);
                        return {
                            items: items.map(({ title, statusId = "todo", owner = "", note = "", url = "", parentId = null }) => {
                                requireStatus(boardId, statusId);
                                validateUrl(url);
                                if (parentId && !db.prepare(
                                    "SELECT 1 FROM items WHERE id = ? AND boardId = ? AND parentId IS NULL"
                                ).get(parentId, boardId)) invalid("Choose a summary item from this tracker as the parent.");
                                const id = randomUUID();
                                insert.run(id, boardId, statusId, title, owner, note, url, now, now, parentId);
                                return formatItem(readItem.get(id));
                            }),
                        };
                    });
                case "update_item":
                    return transaction("BEGIN IMMEDIATE", () => {
                        const { boardId, itemId, version, changes } = input;
                        const { title, statusId, owner, note, url, hidden } = changes;
                        if (url !== undefined) validateUrl(url);
                        if (statusId !== undefined) requireStatus(boardId, statusId);
                        const result = db.prepare(`
                            UPDATE items SET title = COALESCE(?, title), statusId = COALESCE(?, statusId),
                                owner = COALESCE(?, owner), note = COALESCE(?, note), url = COALESCE(?, url),
                                hidden = COALESCE(?, hidden),
                                updatedAt = ?, version = version + 1 WHERE boardId = ? AND id = ? AND version = ?
                        `).run(title ?? null, statusId ?? null, owner ?? null, note ?? null, url ?? null,
                            hidden === undefined ? null : Number(hidden), now, boardId, itemId, version);
                        if (!result.changes) throw changed();
                        return formatItem(readItem.get(itemId));
                    });
                case "remove_item":
                    return transaction("BEGIN IMMEDIATE", () => {
                        const { boardId, itemId, version } = input;
                        const item = readItem.get(itemId);
                        if (item?.boardId !== boardId || item.version !== version) throw changed();
                        if (db.prepare("SELECT 1 FROM items WHERE parentId = ?").get(itemId)) {
                            throw new TrackerError("item_has_details",
                                "This item still has subtasks. Open the subtasks and remove them first, or keep this item.", 409);
                        }
                        db.prepare("DELETE FROM items WHERE id = ?").run(itemId);
                        return { id: itemId };
                    });
            }
        },
    };
}
