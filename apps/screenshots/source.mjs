import { DatabaseSync } from "node:sqlite";
import { open, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, resolve } from "node:path";

const formats = new Map([[".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
    [".gif", "image/gif"], [".webp", "image/webp"]]);
const MAX_RECORD = 64 * 1024 * 1024;
const MAX_IMAGE = 32 * 1024 * 1024;
const MAX_IMAGES = 5000;
export const sourceError = (code, message) => Object.assign(new Error(message), { code });
const safeId = (id) => typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id);
const timestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const validAssetId = (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const screenshotTool = (name) => typeof name === "string" && /(?:^|[-_])(?:browser_take_screenshot|take_screenshot|screenshot)$/.test(name);

async function* journalLines(file, size) {
    if (!size) return;
    let parts = [], length = 0, offset = 0;
    const append = part => {
        length += part.length;
        if (length <= MAX_RECORD) parts.push(part);
        else parts = [];
    };
    const text = () => length <= MAX_RECORD ? Buffer.concat(parts, length).toString("utf8") : null;
    for await (const chunk of file.createReadStream({ autoClose: false, end: size - 1 })) {
        let start = 0, end;
        while ((end = chunk.indexOf(10, start)) !== -1) {
            append(chunk.subarray(start, end + 1));
            yield { text: text(), offset, length };
            offset += length;
            parts = []; length = 0; start = end + 1;
        }
        if (start < chunk.length) append(chunk.subarray(start));
    }
    if (length) yield { text: text(), offset, length };
}

function rows(db, table, required, optional = []) {
    const columns = new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map((row) => row.name));
    if (!columns.size && !required.length) return [];
    if (required.some((column) => !columns.has(column))) {
        throw sourceError("unsupported_schema", `Copilot metadata lacks required ${table} fields. Update the app or Screenshots adapter.`);
    }
    const fields = [...required, ...optional].map((field) => columns.has(field) ? `"${field}"` : `NULL AS "${field}"`);
    return db.prepare(`SELECT ${fields.join(", ")} FROM "${table}" LIMIT 10001`).all();
}

export function readSessions(path) {
    let db;
    try {
        db = new DatabaseSync(path, { readOnly: true });
        db.exec("PRAGMA busy_timeout = 1000; BEGIN");
        const sessions = rows(db, "sessions", ["id"], ["title", "session_type", "updated_at", "archived_at", "execution_location"]);
        const workspaces = rows(db, "workspaces", [], ["id", "name", "project_id", "session_id", "creator_session_id", "archived_at", "updated_at"]);
        const aliases = rows(db, "workspace_session_aliases", [], ["session_id", "workspace_id"]);
        const projects = new Map(rows(db, "projects", [], ["id", "name"]).map((row) => [row.id, row.name]));
        const workspaceParents = new Map(rows(db, "workspace_parent_links", [], ["child_workspace_id", "parent_workspace_id"])
            .filter((row) => row.child_workspace_id && row.parent_workspace_id)
            .map((row) => [row.child_workspace_id, row.parent_workspace_id]));
        const parents = new Map();
        for (const table of ["chat_parent_links", "session_side_chats", "workspace_side_chats"]) {
            for (const row of rows(db, table, [], ["session_id", "parent_session_id", "workspace_id"])) {
                if (!parents.has(row.session_id)) parents.set(row.session_id, row.parent_session_id || row.workspace_id);
            }
        }
        const byId = new Map(sessions.map((row) => [row.id, row]));
        const identities = new Map();
        const associated = new Set();
        const records = [];
        for (const workspace of workspaces) {
            const ids = [...new Set([workspace.session_id, workspace.id,
                ...aliases.filter((alias) => alias.workspace_id === workspace.id).map((alias) => alias.session_id)].filter(safeId))];
            const raw = byId.get(workspace.session_id) ?? byId.get(workspace.id) ??
                ids.map((id) => byId.get(id)).filter(Boolean).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
            const id = raw?.id ?? workspace.id;
            if (!safeId(id)) continue;
            for (const alias of ids) { identities.set(alias, id); associated.add(alias); }
            records.push({ id, ids, raw, workspace, parent: workspaceParents.get(workspace.id) ?? workspace.creator_session_id });
        }
        for (const raw of sessions) {
            if (!safeId(raw.id) || associated.has(raw.id)) continue;
            identities.set(raw.id, raw.id);
            records.push({ id: raw.id, ids: [raw.id], raw, parent: parents.get(raw.id) });
        }
        const result = records.map(({ id, ids, raw, workspace, parent }) => ({
            id, aliases: ids, name: workspace?.name || raw?.title || "Untitled session",
            project: projects.get(workspace?.project_id) ?? null,
            archived: Boolean(workspace?.archived_at || raw?.archived_at),
            location: raw?.execution_location || "local",
            updatedAt: timestamp(raw?.updated_at || workspace?.updated_at),
            parentId: identities.get(parent) ?? null,
        }));
        const resultById = new Map(result.map((row) => [row.id, row]));
        const warnings = [];
        for (const row of result) {
            const visited = new Set([row.id]);
            let cursor = row.parentId;
            while (cursor) {
                if (visited.has(cursor)) {
                    row.parentId = null;
                    warnings.push("A cyclic session link was detached.");
                    break;
                }
                visited.add(cursor);
                cursor = resultById.get(cursor)?.parentId;
            }
        }
        if ([sessions, workspaces, aliases].some((list) => list.length > 10000)) {
            warnings.push("Session metadata exceeds the 10,000-record discovery limit. Some sessions may be unavailable.");
        }
        return { sessions: result, warnings: [...new Set(warnings)] };
    } catch (error) {
        if (error.code === "unsupported_schema") throw error;
        throw sourceError("database_unavailable", `Cannot read local Copilot metadata: ${error.message}`);
    } finally { db?.close(); }
}

function localPath(value, cwd) {
    if (typeof value !== "string" || !value || value.length > 32768 || value.includes("\0") ||
        /^(?:[a-z]+:\/\/|\\\\|\/\/)/i.test(value)) return null;
    if (!formats.has(extname(value).toLowerCase())) return null;
    if (isAbsolute(value)) return resolve(value);
    return cwd && isAbsolute(cwd) ? resolve(cwd, value) : null;
}

function dimensions(buffer, mime) {
    if (mime === "image/png" && buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
    }
    if (mime === "image/gif" && buffer.length >= 10 && /^GIF8[79]a$/.test(buffer.toString("ascii", 0, 6))) {
        return [buffer.readUInt16LE(6), buffer.readUInt16LE(8)];
    }
    if (mime === "image/webp" && buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
        const type = buffer.toString("ascii", 12, 16);
        if (type === "VP8X") return [buffer.readUIntLE(24, 3) + 1, buffer.readUIntLE(27, 3) + 1];
        if (type === "VP8 " && buffer[23] === 0x9d && buffer[24] === 1 && buffer[25] === 0x2a) return [buffer.readUInt16LE(26) & 16383, buffer.readUInt16LE(28) & 16383];
        if (type === "VP8L" && buffer[20] === 0x2f) return [1 + (((buffer[22] & 63) << 8) | buffer[21]), 1 + (((buffer[24] & 15) << 10) | (buffer[23] << 2) | (buffer[22] >> 6))];
    }
    if (mime === "image/jpeg" && buffer[0] === 255 && buffer[1] === 216) {
        let offset = 2;
        while (offset + 9 < buffer.length) {
            if (buffer[offset] !== 255) break;
            const marker = buffer[offset + 1];
            if (marker === 255) { offset++; continue; }
            if (marker === 0xd9 || marker === 0xda) break;
            const size = buffer.readUInt16BE(offset + 2);
            if (size < 2) break;
            if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
                return [buffer.readUInt16BE(offset + 7), buffer.readUInt16BE(offset + 5)];
            }
            offset += size + 2;
        }
    }
    return null;
}

async function inspectImage(reference) {
    const item = { ...reference, availability: "missing", reason: "The referenced file is no longer present.",
        size: null, width: null, height: null, realPath: null, fingerprint: null, storage: "file" };
    if (!item.path) {
        return { ...item, availability: "unavailable", reason: "No usable local image path was retained." };
    }
    let file;
    try {
        item.realPath = await realpath(item.path);
        if (/^(?:\\\\|\/\/)/.test(item.realPath)) throw sourceError("network_path", "Network image paths are not loaded.");
        file = await open(item.realPath, "r");
        const info = await file.stat();
        if (!info.isFile()) throw sourceError("not_file", "The image reference is not a regular file.");
        item.size = info.size;
        if (!item.timestamp) {
            item.timestamp = timestamp(info.mtime.toISOString());
            item.timestampBasis = "file modified";
        }
        if (info.size > MAX_IMAGE) throw sourceError("too_large", "Image exceeds the 32 MiB preview limit.");
        const buffer = Buffer.alloc(Math.min(info.size, 256 * 1024));
        await file.read(buffer, 0, buffer.length, 0);
        const size = dimensions(buffer, item.mime);
        if (!size || size.some((value) => !value) || size[0] * size[1] > 100000000) {
            throw sourceError("unsupported_image", "Unsupported, corrupt, or oversized image header.");
        }
        [item.width, item.height] = size;
        item.fingerprint = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
        item.availability = "available";
        item.reason = null;
    } catch (error) {
        if (error.code !== "ENOENT") {
            item.availability = "unavailable";
            item.reason = error.code === "EACCES" || error.code === "EPERM" ? "Permission to read this image was denied." : error.message;
        }
    } finally { await file?.close(); }
    return item;
}

async function retainedImage(asset) {
    if (!asset || !validAssetId(asset.assetId) || asset.length <= 0 || asset.length > MAX_RECORD) {
        throw sourceError("asset_unavailable", "No retained session image is available.");
    }
    let file;
    try {
        file = await open(asset.path, "r");
        const buffer = Buffer.alloc(asset.length);
        let read = 0;
        while (read < buffer.length) {
            const { bytesRead } = await file.read(buffer, read, buffer.length - read, asset.offset + read);
            if (!bytesRead) throw sourceError("asset_changed", "The retained image history changed. Refresh to retry.");
            read += bytesRead;
        }
        const event = JSON.parse(buffer.toString("utf8"));
        const data = event?.data;
        if (event.type !== "session.binary_asset" || data?.assetId !== asset.assetId ||
            data.type !== "image" || ![...formats.values()].includes(data.mimeType) ||
            typeof data.data !== "string" || data.data.length > Math.ceil(MAX_IMAGE / 3) * 4 ||
            !Number.isSafeInteger(data.byteLength) || data.byteLength <= 0 || data.byteLength > MAX_IMAGE) {
            throw sourceError("asset_invalid", "The retained image metadata is unsupported or exceeds the preview limit.");
        }
        const bytes = Buffer.from(data.data, "base64");
        if (bytes.length !== data.byteLength || `sha256:${digest(bytes)}` !== asset.assetId) {
            throw sourceError("asset_invalid", "The retained image failed its content-integrity check.");
        }
        const size = dimensions(bytes.subarray(0, 256 * 1024), data.mimeType);
        if (!size || size.some((value) => !value) || size[0] * size[1] > 100000000) {
            throw sourceError("asset_invalid", "The retained image header is unsupported or exceeds the preview limit.");
        }
        return { data: bytes, mime: data.mimeType, size: bytes.length, width: size[0], height: size[1] };
    } catch (error) {
        throw sourceError(error.code ?? "asset_unavailable", `Cannot read the retained session image: ${error.message}`);
    } finally { await file?.close(); }
}

async function inspectReference(reference, assets) {
    const image = await inspectImage(reference);
    if (image.availability === "available" || !reference.assetId) return image;
    const asset = assets.get(reference.assetId);
    if (!asset) return image;
    try {
        const retained = await retainedImage(asset);
        return { ...image, availability: "available", reason: null, storage: "session", retainedAsset: asset,
            mime: retained.mime, size: retained.size, width: retained.width, height: retained.height };
    } catch (error) {
        return { ...image, reason: `${image.reason} ${error.message}` };
    }
}

async function discover(home, session, warnings, budget) {
    const references = new Map();
    const assets = new Map();
    let truncated = false;
    let histories = 0;
    const add = (value, cwd, source, date, tool, fallbackId, assetId) => {
        const path = localPath(value, cwd);
        if (!path && typeof value === "string" && !formats.has(extname(value).toLowerCase())) return;
        const key = path ? (process.platform === "win32" ? path.toLowerCase() : path) : validAssetId(assetId) ? assetId : `inline:${fallbackId}`;
        const existing = references.get(key);
        if (existing) {
            if (validAssetId(assetId)) existing.assetId = assetId;
            if ((existing.source === "unknown" && source !== "unknown") ||
                (existing.source === "tool" && ["uploaded", "generated"].includes(source))) {
                existing.source = source; existing.tool = tool || null;
            }
            return;
        }
        if (references.size >= MAX_IMAGES) { truncated = true; return; }
        references.set(key, {
            id: digest(`${session.id}\0${key}`), sessionId: session.id, sessionName: session.name,
            name: path ? basename(path) : validAssetId(assetId) ? "Retained image" : "Unavailable inline image",
            path, source, tool: tool || null, mime: path ? formats.get(extname(path).toLowerCase()) : null,
            timestamp: timestamp(date), timestampBasis: timestamp(date) ? "session event" : "unknown",
            assetId: validAssetId(assetId) ? assetId : null,
        });
    };
    if (session.location !== "local") {
        warnings.push(`${session.name}: ${session.location} files are not accessible through the local adapter.`);
        return [];
    }
    for (const alias of session.aliases.slice(0, 32)) {
        const eventPath = join(home, "session-state", alias, "events.jsonl");
        let file;
        try {
            file = await open(eventPath, "r");
            histories++;
            const info = await file.stat();
            if (info.size > budget.bytes) {
                warnings.push(`${session.name}: history exceeds the remaining 128 MiB scope budget. Select a smaller session scope.`);
                continue;
            }
            budget.bytes -= info.size;
            let cwd = null;
            const tools = new Map();
            let lineNumber = 0;
            for await (const line of journalLines(file, info.size)) {
                lineNumber++;
                if (line.text === null) {
                    warnings.push(`${session.name}: a history record exceeds 64 MiB and was skipped.`);
                    continue;
                }
                if (!line.text.trim()) continue;
                let event;
                try { event = JSON.parse(line.text); }
                catch {
                    warnings.push(`${session.name}: an incomplete or invalid history record was skipped.`);
                    continue;
                }
                const data = event?.data;
                if (!data || typeof data !== "object") continue;
                if (event.type === "session.binary_asset" && validAssetId(data.assetId) && data.type === "image") {
                    assets.set(data.assetId, { assetId: data.assetId, path: eventPath, offset: line.offset, length: line.length });
                    continue;
                }
                if (event.type === "session.start") cwd = data.context?.cwd ?? null;
                if (event.type === "user.message" && Array.isArray(data.attachments)) {
                    for (const [index, attachment] of data.attachments.entries()) {
                        if (!attachment || typeof attachment !== "object") continue;
                        if (attachment.type === "file" && typeof attachment.path === "string") {
                            add(attachment.path, cwd, "uploaded", event.timestamp, null, `${alias}:${lineNumber}:${index}`, attachment.assetId);
                        } else if (typeof attachment.mimeType === "string" && [...formats.values()].includes(attachment.mimeType)) {
                            add(null, cwd, "uploaded", event.timestamp, null, `${alias}:${lineNumber}:${index}`, attachment.assetId);
                        }
                    }
                }
                if (event.type === "tool.execution_start" && typeof data.toolCallId === "string") {
                    tools.set(data.toolCallId, { name: data.toolName, args: data.arguments });
                }
                if (event.type === "tool.execution_complete") {
                    const tool = tools.get(data.toolCallId);
                    tools.delete(data.toolCallId);
                    if (data.success !== true) continue;
                    const content = typeof data.result?.content === "string" ? data.result.content : "";
                    if (data.result?.error || data.result?.isError === true || /^(?:### Error\b|MCP server [^\r\n]*: ### Error\b)/.test(content)) continue;
                    const capture = screenshotTool(tool?.name);
                    let found = false;
                    const resultText = capture ? content.split(/^### Ran /m)[0].replace(/```[\s\S]*?(?:```|$)/g, "") : "";
                    for (const match of resultText.matchAll(/\[[^\]\r\n]*\]\(([^)\r\n]+)\)/g)) {
                        let value = match[1].replace(/^<|>$/g, "");
                        try { value = decodeURIComponent(value); } catch { /* A literal percent is also a valid filename. */ }
                        if (localPath(value, cwd)) {
                            add(value, cwd, "generated", event.timestamp, tool?.name, `${alias}:${lineNumber}`);
                            found = true;
                        }
                    }
                    if (capture && !found) {
                        const value = tool?.args?.filename ?? tool?.args?.path;
                        if (typeof value === "string") add(value, cwd, "generated", event.timestamp, tool.name, `${alias}:${lineNumber}`);
                        else warnings.push(`${session.name}: a screenshot result has no retained local file path.`);
                    }
                    if (Array.isArray(data.result?.binaryResultsForLlm)) {
                        for (const [index, binary] of data.result.binaryResultsForLlm.entries()) {
                            if (binary?.type !== "image" || !validAssetId(binary.assetId) || ![...formats.values()].includes(binary.mimeType)) continue;
                            const path = tool?.name === "view" ? tool.args?.path : capture ? tool.args?.filename ?? tool.args?.path : null;
                            add(path, cwd, capture ? "generated" : tool?.name ? "tool" : "unknown", event.timestamp, tool?.name, `${alias}:${lineNumber}:${index}`, binary.assetId);
                        }
                    }
                }
            }
        } catch (error) {
            if (error.code !== "ENOENT") warnings.push(`${session.name}: history could not be read (${error.code ?? error.message}).`);
        } finally { await file?.close(); }
    }
    if (!histories) warnings.push(`${session.name}: local session history is not retained or accessible.`);
    if (session.aliases.length > 32) warnings.push(`${session.name}: only the first 32 session identities were scanned.`);
    if (truncated) warnings.push(`${session.name}: only the first ${MAX_IMAGES} image references were loaded.`);
    const result = [];
    const refs = [...references.values()];
    for (let index = 0; index < refs.length; index += 16) {
        result.push(...await Promise.all(refs.slice(index, index + 16).map((reference) => inspectReference(reference, assets))));
    }
    return result;
}

export function publicImage({ realPath, fingerprint, retainedAsset, ...item }) { return item; }

export function createCatalog({ home = process.env.COPILOT_HOME || join(homedir(), ".copilot"), database = join(home, "data.db") } = {}) {
    let snapshot = null;
    const imagesById = new Map();
    const sessions = (preferredSessionId) => {
        snapshot = readSessions(database);
        const preferred = snapshot.sessions.find((session) => session.id === preferredSessionId || session.aliases.includes(preferredSessionId));
        return { ...snapshot, sessions: snapshot.sessions.map(({ aliases, ...session }) => session),
            defaultSessionId: preferred?.id ?? null, collectedAt: new Date().toISOString() };
    };
    return {
        sessions,
        async images(sessionId, { includeChildren = false, includeArchived = false } = {}) {
            if (typeof includeChildren !== "boolean" || typeof includeArchived !== "boolean") throw sourceError("invalid_input", "Scope flags must be booleans.");
            if (!snapshot) sessions();
            const selected = snapshot.sessions.find((session) => session.id === sessionId || session.aliases.includes(sessionId));
            if (!selected) throw sourceError("session_missing", "Select a session from the current session list.");
            const scope = new Set([selected.id]);
            if (includeChildren) {
                let changed = true;
                while (changed) {
                    changed = false;
                    for (const session of snapshot.sessions) {
                        if (scope.has(session.parentId) && !scope.has(session.id)) { scope.add(session.id); changed = true; }
                    }
                }
            }
            const warnings = [...snapshot.warnings];
            const scoped = snapshot.sessions.filter((session) => scope.has(session.id) && (includeArchived || !session.archived));
            if (scoped.length > 100) warnings.push("Only the first 100 sessions in this scope were scanned.");
            const images = [];
            const scannedSessionIds = [];
            const budget = { bytes: 128 * 1024 * 1024 };
            for (const session of scoped.slice(0, 100)) {
                if (images.length >= 10000) {
                    warnings.push("The scope reached the 10,000-image discovery limit. Select a smaller session scope.");
                    break;
                }
                const records = await discover(home, session, warnings, budget);
                scannedSessionIds.push(session.id);
                for (const [id, item] of imagesById) if (item.sessionId === session.id) imagesById.delete(id);
                const remaining = 10000 - images.length;
                if (records.length > remaining) warnings.push("The scope reached the 10,000-image discovery limit. Some records were not loaded.");
                for (const record of records.slice(0, remaining)) imagesById.set(record.id, record);
                images.push(...records.slice(0, remaining).map(publicImage));
            }
            while (imagesById.size > 20000) imagesById.delete(imagesById.keys().next().value);
            return { sessionId: selected.id, scannedSessionIds, images, warnings: [...new Set(warnings)], collectedAt: new Date().toISOString() };
        },
        metadata(id) {
            const image = imagesById.get(id);
            if (!image) throw sourceError("image_missing", "This image is not in the loaded session catalog.");
            return publicImage(image);
        },
        async openImage(id) {
            const image = imagesById.get(id);
            if (!image || image.availability !== "available") throw sourceError("image_unavailable", "The indexed image is unavailable. Refresh and retry.");
            if (image.storage === "session") return retainedImage(image.retainedAsset);
            let file;
            try {
                if (await realpath(image.path) !== image.realPath) throw sourceError("image_changed", "The image path changed. Refresh before opening it.");
                file = await open(image.realPath, "r");
                const info = await file.stat();
                if (!info.isFile() || `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}` !== image.fingerprint) {
                    throw sourceError("image_changed", "The image changed. Refresh before opening it.");
                }
                return { file, mime: image.mime, size: info.size };
            } catch (error) {
                await file?.close();
                throw sourceError(error.code ?? "image_unavailable", `Cannot open image: ${error.message}`);
            }
        },
    };
}
