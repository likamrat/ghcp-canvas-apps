import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { sourceError } from "./image-source.mjs";

export function createStore(path) {
    mkdirSync(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    db.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0)
        );
        CREATE TABLE IF NOT EXISTS revisions (
            id TEXT NOT NULL REFERENCES notes(id), version INTEGER NOT NULL,
            title TEXT NOT NULL, content TEXT NOT NULL, timestamp TEXT NOT NULL,
            PRIMARY KEY (id, version)
        );
        CREATE TABLE IF NOT EXISTS pins (id TEXT PRIMARY KEY);
    `);
    const current = (id) => db.prepare(`SELECT n.session_id AS sessionId, r.* FROM notes n
        JOIN revisions r ON n.id = r.id AND n.version = r.version WHERE n.id = ?`).get(id);
    let closed = false;
    return {
        current,
        pinned(id) { return Boolean(db.prepare("SELECT 1 FROM pins WHERE id = ?").get(id)); },
        pin(id, pinned) {
            if (pinned) db.prepare("INSERT OR IGNORE INTO pins VALUES (?)").run(id);
            else db.prepare("DELETE FROM pins WHERE id = ?").run(id);
        },
        list(sessionIds) {
            return db.prepare(`SELECT n.session_id AS sessionId, r.id, r.version, r.title, r.timestamp,
                length(CAST(r.content AS BLOB)) AS size FROM notes n
                JOIN revisions r ON n.id = r.id AND n.version = r.version
                WHERE n.session_id IN (SELECT value FROM json_each(?)) LIMIT 10001`).all(JSON.stringify(sessionIds));
        },
        revision(id, version) {
            return db.prepare(`SELECT n.session_id AS sessionId, r.* FROM notes n
                JOIN revisions r ON n.id = r.id WHERE n.id = ? AND r.version = ?`).get(id, version);
        },
        revisions(id) { return db.prepare("SELECT version, timestamp, title FROM revisions WHERE id = ? ORDER BY version DESC").all(id); },
        publish({ sessionId, title, content, id, expectedVersion, ownerSessionIds = [sessionId] }) {
            const timestamp = new Date().toISOString();
            db.exec("BEGIN IMMEDIATE");
            try {
                if (id === undefined) {
                    id = randomBytes(32).toString("hex");
                    db.prepare("INSERT INTO notes VALUES (?, ?, 1)").run(id, sessionId);
                } else {
                    const result = db.prepare(`UPDATE notes SET version = version + 1
                        WHERE id = ? AND session_id IN (SELECT value FROM json_each(?)) AND version = ?`)
                        .run(id, JSON.stringify(ownerSessionIds), expectedVersion);
                    if (!result.changes) throw sourceError("version_conflict", "This publication changed or belongs to another session. Reload before editing.");
                }
                const { version } = db.prepare("SELECT version FROM notes WHERE id = ?").get(id);
                db.prepare("INSERT INTO revisions VALUES (?, ?, ?, ?, ?)").run(id, version, title, content, timestamp);
                db.exec("COMMIT");
                return current(id);
            } catch (error) { db.exec("ROLLBACK"); throw error; }
        },
        close() { if (!closed) { db.close(); closed = true; } },
    };
}
