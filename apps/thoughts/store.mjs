import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const textSchema = { type: "string", minLength: 1, maxLength: 4000 };
export const actionSchemas = {
    list: { type: "object", properties: {}, additionalProperties: false },
    add: {
        type: "object", properties: { text: textSchema },
        required: ["text"], additionalProperties: false,
    },
    update: {
        type: "object",
        properties: {
            id: { type: "string", minLength: 1 },
            version: { type: "integer", minimum: 1 },
            text: textSchema, done: { type: "boolean" },
        },
        required: ["id", "version"],
        anyOf: [{ required: ["text"] }, { required: ["done"] }],
        additionalProperties: false,
    },
    delete: {
        type: "object",
        properties: {
            id: { type: "string", minLength: 1 },
            version: { type: "integer", minimum: 1 },
        },
        required: ["id", "version"],
        additionalProperties: false,
    },
};

function fail(code, message) {
    throw Object.assign(new Error(message), { code });
}

function validateText(text) {
    if (typeof text !== "string" || !text.trim() || text.length > 4000) {
        fail("invalid_input", "Write a thought between 1 and 4,000 characters.");
    }
    return text.trim();
}

export function createStore(path = join(
    process.env.COPILOT_HOME || join(homedir(), ".copilot"),
    "extensions", "idea-inbox", "artifacts", "ideas.sqlite",
)) {
    mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS ideas (
            id TEXT PRIMARY KEY,
            text TEXT NOT NULL,
            done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0, 1)),
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1
        );
    `);
    const list = () => ({
        items: db.prepare("SELECT * FROM ideas ORDER BY createdAt DESC, id").all()
            .map((item) => ({ ...item, done: Boolean(item.done) })),
    });
    return {
        close: () => db.close(),
        run(name, input) {
            if (!input || typeof input !== "object" || Array.isArray(input)) {
                fail("invalid_input", "Expected an object.");
            }
            const schema = actionSchemas[name];
            if (!schema) fail("unknown_action", "Unknown Thoughts action.");
            if (Object.keys(input).some((key) => !(key in schema.properties))) {
                fail("invalid_input", "Unexpected input field.");
            }
            if (name === "list") return list();
            if (name === "add") {
                const text = validateText(input.text);
                const now = new Date().toISOString();
                const id = randomUUID();
                db.prepare("INSERT INTO ideas (id, text, createdAt, updatedAt) VALUES (?, ?, ?, ?)")
                    .run(id, text, now, now);
                return { id, ...list() };
            }
            if (typeof input.id !== "string" || !input.id ||
                !Number.isSafeInteger(input.version) || input.version < 1) {
                fail("invalid_input", "Provide an item ID and current version.");
            }
            if (name === "delete") {
                const result = db.prepare("DELETE FROM ideas WHERE id = ? AND version = ?")
                    .run(input.id, input.version);
                if (!result.changes) {
                    fail("item_changed", "This thought changed or was deleted in another chat. Reload before trying again.");
                }
                return list();
            }
            if ((input.text === undefined && input.done === undefined) ||
                (input.done !== undefined && typeof input.done !== "boolean")) {
                fail("invalid_input", "Provide an item ID, current version, and text or done status.");
            }
            const text = input.text === undefined ? null : validateText(input.text);
            const done = input.done === undefined ? null : Number(input.done);
            const result = db.prepare(`
                UPDATE ideas SET text = COALESCE(?, text), done = COALESCE(?, done),
                    updatedAt = ?, version = version + 1 WHERE id = ? AND version = ?
            `).run(text, done, new Date().toISOString(), input.id, input.version);
            if (!result.changes) {
                fail("item_changed", "This item changed in another chat. Reload the list before trying again.");
            }
            return list();
        },
    };
}
