import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_THRESHOLDS, validateThresholds } from "./model.mjs";

export const settingsSchema = {
    type: "object",
    properties: {
        watch: { type: "integer", minimum: 0, maximum: 100 },
        high: { type: "integer", minimum: 0, maximum: 100 },
        version: { type: "integer", minimum: 1 },
    },
    required: ["watch", "high", "version"],
    additionalProperties: false,
};

export function createSettings(path = join(
    process.env.COPILOT_HOME || join(homedir(), ".copilot"),
    "extensions", "context-monitor", "artifacts", "settings.sqlite",
)) {
    mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS preferences (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            watch INTEGER NOT NULL,
            high INTEGER NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            CHECK(watch >= 0 AND watch < high AND high <= 100)
        );
    `);
    db.prepare("INSERT OR IGNORE INTO preferences (id, watch, high) VALUES (1, ?, ?)")
        .run(DEFAULT_THRESHOLDS.watch, DEFAULT_THRESHOLDS.high);
    const read = () => {
        const row = db.prepare("SELECT watch, high, version FROM preferences WHERE id = 1").get();
        if (!row) throw new Error("Context Monitor preferences are missing.");
        return { thresholds: validateThresholds(row), defaults: DEFAULT_THRESHOLDS, version: row.version };
    };
    return {
        read,
        close: () => db.close(),
        update(input) {
            if (!input || typeof input !== "object" || Array.isArray(input) ||
                Object.keys(input).some((key) => !Object.hasOwn(settingsSchema.properties, key)) ||
                !Number.isSafeInteger(input.version) || input.version < 1) {
                throw Object.assign(new Error("Provide both usage warning levels and the current settings version."), { code: "invalid_input" });
            }
            const { watch, high } = validateThresholds(input);
            const result = db.prepare(`
                UPDATE preferences SET watch = ?, high = ?, version = version + 1
                WHERE id = 1 AND version = ?
            `).run(watch, high, input.version);
            if (!result.changes) {
                throw Object.assign(new Error("Usage warnings changed in another view. Review your draft and Apply again."),
                    { code: "settings_changed", settings: read() });
            }
            return read();
        },
    };
}
