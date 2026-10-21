import { open, realpath, opendir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readSessions, sourceError, discover, retainedImage, inspectReference, fileFingerprint, hashFile } from "./image-source.mjs";
import { createStore } from "./store.mjs";
import { localReference, markdownReferences } from "./render.mjs";

export { sourceError };
const TEXT_LIMIT = 1024 * 1024;
const FILE_LIMIT = 32 * TEXT_LIMIT;
const SCOPE_LIMIT = 10000;
const SCOPE_WARNING = "The 10,000-artifact scope limit was reached. Select a smaller session scope.";
const formats = new Map([
    [".md", ["document", "text/markdown"]], [".markdown", ["document", "text/markdown"]],
    [".txt", ["document", "text/plain"]], [".json", ["document", "application/json"]],
    [".yaml", ["document", "application/yaml"]], [".yml", ["document", "application/yaml"]],
    [".csv", ["table", "text/csv"]], [".tsv", ["table", "text/tab-separated-values"]],
    [".svg", ["diagram", "image/svg+xml"]], [".png", ["image", "image/png"]],
    [".jpg", ["image", "image/jpeg"]], [".jpeg", ["image", "image/jpeg"]],
    [".gif", ["image", "image/gif"]], [".webp", ["image", "image/webp"]],
    [".pdf", ["file", "application/pdf"]],
    [".docx", ["document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]],
    [".xlsx", ["table", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]],
    [".pptx", ["document", "application/vnd.openxmlformats-officedocument.presentationml.presentation"]],
]);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const keyPath = (path) => process.platform === "win32" ? path.toLowerCase() : path;
const stamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const within = (root, path) => {
    const rel = relative(root, path);
    return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
};
const secret = (path) => path.split(/[\\/]/).some((part) => (part.startsWith(".") && ![".", "..", ".copilot"].includes(part)) ||
    /^(?:credentials?|secrets?|id_rsa|id_ed25519)(?:\.|$)/i.test(part));
const isText = (record) => record.mime.startsWith("text/") || ["application/json", "application/yaml"].includes(record.mime);
const publicRecord = ({ realPath, fingerprint: ignored, contentHash, root, retainedAsset, blockedReason, ...record }) => record;

function artifactRoot(home, path) {
    const root = resolve(home, "session-state");
    if (!within(root, path)) return null;
    const parts = relative(root, path).split(sep);
    return parts.length >= 3 && parts[1] === "files" ? join(root, parts[0], "files") : null;
}

function eventCollector(home, session, warnings) {
    const refs = new Map(), tools = new Map();
    const add = (value, cwd, source, event, tool = null) => {
        if (typeof value !== "string" || !value || value.length > 32768 || value.includes("\0") ||
            /^(?:[a-z]+:\/\/|\\\\|\/\/)/i.test(value) || !formats.has(extname(value).toLowerCase())) return;
        if (!isAbsolute(value) && (typeof cwd !== "string" || !isAbsolute(cwd))) {
            warnings.push(`${session.name}: a relative artifact path has no retained working directory.`);
            return;
        }
        const path = isAbsolute(value) ? resolve(value) : resolve(cwd, value);
        if (secret(relative(home, path))) return;
        if (refs.size >= 5000) {
            warnings.push(`${session.name}: the 5,000-reference discovery limit was reached.`);
            return;
        }
        const record = reference(session, path, source, { timestamp: stamp(event.timestamp),
            timestampBasis: stamp(event.timestamp) ? "session event" : "unknown", tool,
            eventId: typeof event.id === "string" ? event.id : null });
        const existing = refs.get(record.id);
        if (!existing || source === "generated" || source === "uploaded") refs.set(record.id, record);
    };
    return {
        refs,
        visit(event, cwd, alias) {
            const data = event.data;
            if (event.type === "user.message" && Array.isArray(data.attachments)) {
                for (const attachment of data.attachments) {
                    if (attachment?.type === "file") add(attachment.path, cwd, "uploaded", event);
                }
            }
            const key = `${alias}:${data.toolCallId}`;
            if (event.type === "tool.execution_start" && typeof data.toolCallId === "string") {
                if (typeof data.toolName !== "string") {
                    warnings.push(`${session.name}: a malformed tool record was skipped.`);
                    return;
                }
                tools.set(key, { name: data.toolName, args: data.arguments });
            }
            if (event.type !== "tool.execution_complete") return;
            const tool = tools.get(key);
            tools.delete(key);
            const result = data.result;
            if (!tool || data.success !== true || result?.error || result?.isError === true ||
                /^(?:### Error\b|MCP server [^\r\n]*: ### Error\b)/.test(result?.content || "")) return;
            const name = tool.name?.replace(/^functions[._-]/, "");
            if (["create", "edit", "view", "write_file", "read_file"].includes(name)) {
                add(tool.args?.path ?? tool.args?.file_path, cwd,
                    ["create", "write_file"].includes(name) ? "generated" : "tool", event, tool.name);
            }
            if (name === "apply_patch") {
                const patch = typeof tool.args === "string" ? tool.args : tool.args?.patch ?? tool.args?.input;
                if (typeof patch === "string") {
                    for (const match of patch.matchAll(/^\*\*\* (Add File|Update File|Move to): (.+)\r?$/gm)) {
                        add(match[2].trim(), cwd, match[1] === "Add File" ? "generated" : "tool", event, tool.name);
                    }
                }
            }
        },
    };
}

async function inspect(record, root, budget, { rejectSymlinks = false } = {}) {
    const item = { ...record, root, realPath: null, fingerprint: null };
    let file;
    try {
        item.realPath = await realpath(record.path);
        if (/^(?:\\\\|\/\/)/.test(item.realPath) || (root && !within(root, item.realPath))) {
            throw sourceError("unsafe_path", "The artifact resolves outside its approved files directory.");
        }
        if (rejectSymlinks && keyPath(item.realPath) !== keyPath(resolve(record.path))) {
            throw sourceError("unsafe_path", "Symbolic links are not loaded as document images.");
        }
        file = await open(item.realPath, "r");
        const info = await file.stat();
        if (!info.isFile()) throw sourceError("not_file", "The artifact is not a regular file.");
        item.size = info.size;
        item.timestamp ??= info.mtime.toISOString();
        if (!record.timestamp) item.timestampBasis = "file modified";
        if (info.size > (isText(item) ? TEXT_LIMIT : FILE_LIMIT)) {
            throw sourceError("too_large", `Artifact exceeds the ${isText(item) ? "1" : "32"} MiB read limit.`);
        }
        if (budget && !budget.files.has(item.id)) {
            if (info.size > budget.bytes) throw sourceError("scope_limit", "Artifact exceeds the remaining 128 MiB scope budget.");
            budget.bytes -= info.size;
            budget.files.add(item.id);
        }
        item.fingerprint = fileFingerprint(info);
        item.availability = "available";
        item.reason = null;
        if (item.kind === "image") {
            const image = await inspectReference(item, new Map());
            Object.assign(item, image);
        } else {
            item.contentHash = await hashFile(file, info.size);
            if (fileFingerprint(await file.stat()) !== item.fingerprint) {
                throw sourceError("artifact_changed", "Artifact changed during inspection; refresh first.");
            }
        }
    } catch (error) {
        item.availability = error.code === "ENOENT" ? "missing" : "unavailable";
        item.reason = error.code === "ENOENT" ? "The referenced file is no longer present." : error.message;
    } finally { await file?.close(); }
    return item;
}

async function readInspected(item, record = publicRecord(item)) {
    let file;
    try {
        if (await realpath(item.path) !== item.realPath) throw sourceError("artifact_changed", "Artifact path changed; refresh first.");
        file = await open(item.realPath, "r");
        const info = await file.stat();
        if (!info.isFile() || fileFingerprint(info) !== item.fingerprint) throw sourceError("artifact_changed", "Artifact changed; refresh first.");
        if (info.size > (isText(item) ? TEXT_LIMIT : FILE_LIMIT)) throw sourceError("too_large", "Artifact exceeds the read limit.");
        const bytes = Buffer.alloc(info.size);
        let offset = 0;
        while (offset < bytes.length) {
            const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
            if (!bytesRead) throw sourceError("artifact_changed", "Artifact changed during reading; refresh first.");
            offset += bytesRead;
        }
        // Windows metadata-only updates can advance ctime; compare captured bytes, not ctime.
        if (fileFingerprint(await file.stat()) !== item.fingerprint || digest(bytes) !== item.contentHash) {
            throw sourceError("artifact_changed", "Artifact content changed; refresh first.");
        }
        return { metadata: record, content: isText(item) ? bytes.toString("utf8") : null,
            bytes: isText(item) ? null : bytes, mime: item.mime, filename: item.name };
    } catch (error) {
        if (["ENOENT", "ENOTDIR"].includes(error.code)) throw sourceError("artifact_changed", "The artifact moved or was removed. Refresh first.");
        if (["EACCES", "EPERM"].includes(error.code)) throw sourceError("artifact_unavailable", "Permission to read this artifact was denied.");
        throw error;
    } finally { await file?.close(); }
}

async function scanFiles(session, directory, warnings, indexed, budget, count, depth = 0, root = directory) {
    try {
        const actual = await realpath(directory);
        if (keyPath(actual) !== keyPath(resolve(directory)) || !within(root, actual)) {
            throw sourceError("unsafe_path", "A symbolic link outside the approved files tree was skipped.");
        }
        const entries = await opendir(directory);
        for await (const entry of entries) {
            if (indexed.size >= SCOPE_LIMIT) { warnings.push(SCOPE_WARNING); break; }
            if (++count.entries > 5000) {
                warnings.push(`${session.name}: the 5,000 directory-entry discovery limit was reached.`);
                break;
            }
            if (secret(entry.name)) continue;
            const path = join(directory, entry.name);
            if (entry.isSymbolicLink()) {
                warnings.push(`${session.name}: a symbolic link in the files tree was skipped.`);
            } else if (entry.isDirectory()) {
                if (depth >= 4) warnings.push(`${session.name}: files beyond the depth-4 discovery limit were skipped.`);
                else await scanFiles(session, path, warnings, indexed, budget, count, depth + 1, root);
            } else if (entry.isFile() && formats.has(extname(path).toLowerCase())) {
                const item = await inspect(reference(session, path), root, budget);
                if (item.availability === "unavailable") warnings.push(`${session.name}: ${item.reason}`);
                indexed.set(item.id, item);
            }
        }
    } catch (error) {
        if (error.code !== "ENOENT") warnings.push(`${session.name}: files could not be read (${error.message}).`);
    }
}

function reference(session, path, source = "session-file", extra = {}) {
    const [kind, mime] = formats.get(extname(path).toLowerCase());
    return {
        id: digest(`${session.id}\0${keyPath(path)}`), sessionId: session.id, sessionName: session.name,
        title: basename(path), name: basename(path), kind, source, path,
        timestamp: null, timestampBasis: "unknown", size: null, mime,
        availability: "missing", reason: null, version: null, pinned: false, tool: null, eventId: null, ...extra,
    };
}

export function createCatalog({
    home = process.env.COPILOT_HOME || join(homedir(), ".copilot"),
    database = join(home, "data.db"),
    storePath = join(home, "extensions", "artifacts", "artifacts", "catalog.sqlite"),
} = {}) {
    const store = createStore(storePath);
    const indexed = new Map();
    const resources = new Map();
    let snapshot;
    const sessions = (preferredSessionId) => {
        try { snapshot = readSessions(database); }
        catch (error) {
            if (!["unsupported_schema", "database_unavailable"].includes(error.code)) throw error;
            indexed.clear();
            snapshot = { sessions: [], warnings: [error.message], error };
        }
        const preferred = snapshot.sessions.find((row) => row.id === preferredSessionId || row.aliases.includes(preferredSessionId));
        return { sessions: snapshot.sessions.map(({ aliases, ...row }) => row), defaultSessionId: preferred?.id ?? null,
            warnings: snapshot.warnings, collectedAt: new Date().toISOString() };
    };
    const metadata = (id) => {
        const record = indexed.get(id);
        if (!record) throw sourceError("artifact_missing", "This artifact is not in the loaded catalog. Refresh first.");
        if (record.source === "published") {
            const current = published(store.current(id), record.sessionName);
            indexed.set(id, current);
            return current;
        }
        record.pinned = store.pinned(id);
        return publicRecord(record);
    };
    const published = (note, sessionName) => {
        const session = snapshot?.sessions.find((row) => row.id === note.sessionId || row.aliases.includes(note.sessionId));
        return {
            id: note.id, sessionId: session?.id ?? note.sessionId, sessionName: session?.name ?? sessionName, title: note.title,
            name: `${note.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/[. ]+$/g, "").slice(0, 100) || "Note"}.md`,
            kind: "document", source: "published", path: null, timestamp: note.timestamp, timestampBasis: "published",
            size: note.size ?? Buffer.byteLength(note.content), mime: "text/markdown", availability: "available", reason: null,
            version: note.version, pinned: store.pinned(note.id), tool: null, eventId: null,
        };
    };
    const catalog = {
        sessions, metadata,
        async artifacts(sessionId, options = {}) {
            if (!options || typeof options !== "object" || Array.isArray(options) ||
                Object.keys(options).some((key) => !["includeChildren", "includeArchived"].includes(key))) {
                throw sourceError("invalid_input", "Provide artifact scope options.");
            }
            const { includeChildren = false, includeArchived = false } = options;
            if (typeof includeChildren !== "boolean" || typeof includeArchived !== "boolean") {
                throw sourceError("invalid_input", "Scope flags must be booleans.");
            }
            sessions();
            if (snapshot.error) throw snapshot.error;
            const selected = snapshot.sessions.find((row) => row.id === sessionId || row.aliases.includes(sessionId));
            if (!selected) throw sourceError("session_missing", "Select a session from the current session list.");
            const loaded = new Map();
            const warnings = [...snapshot.warnings];
            const scope = new Set([selected.id]);
            if (includeChildren) {
                let changed = true;
                while (changed) {
                    changed = false;
                    for (const row of snapshot.sessions) {
                        if (scope.has(row.parentId) && !scope.has(row.id)) { scope.add(row.id); changed = true; }
                    }
                }
            }
            const scoped = snapshot.sessions.filter((row) => scope.has(row.id) && (includeArchived || !row.archived));
            if (scoped.length > 100) warnings.push("Only the first 100 sessions in this scope were scanned.");
            const budget = { bytes: 128 * TEXT_LIMIT, files: new Set() };
            for (const session of scoped.slice(0, 100)) {
                if (loaded.size >= SCOPE_LIMIT) { warnings.push(SCOPE_WARNING); break; }
                if (session.location !== "local") {
                    warnings.push(`${session.name}: ${session.location} files are not accessible through the local adapter.`);
                    continue;
                }
                const count = { entries: 0 };
                for (const alias of session.aliases.slice(0, 32)) {
                    const directory = join(home, "session-state", alias, "files");
                    await scanFiles(session, directory, warnings, loaded, budget, count);
                }
                if (session.aliases.length > 32) warnings.push(`${session.name}: only the first 32 session identities were scanned.`);
                const collector = eventCollector(home, session, warnings);
                const images = await discover(home, session, warnings, budget, collector.visit, (path) => ({
                    root: path ? artifactRoot(home, path) : null,
                    blockedReason: path && secret(relative(home, path)) ? "A sensitive image reference was excluded." : null,
                }));
                for (const record of collector.refs.values()) {
                    if (loaded.size >= SCOPE_LIMIT && !loaded.has(record.id)) { warnings.push(SCOPE_WARNING); break; }
                    const item = await inspect(record, artifactRoot(home, record.path), budget);
                    if (item.availability === "unavailable") warnings.push(`${session.name}: ${item.reason}`);
                    loaded.set(item.id, item);
                }
                for (const image of images) {
                    if (loaded.size >= SCOPE_LIMIT && !loaded.has(image.id)) { warnings.push(SCOPE_WARNING); break; }
                    const existing = loaded.get(image.id);
                    loaded.set(image.id, {
                        ...existing, ...image, title: image.name, kind: "image", mime: image.mime || "application/octet-stream",
                        version: null, pinned: false, eventId: existing?.eventId ?? null,
                    });
                }
                for (const note of store.list([...new Set([session.id, ...session.aliases])])) {
                    if (loaded.size >= SCOPE_LIMIT) { warnings.push(SCOPE_WARNING); break; }
                    loaded.set(note.id, published(note, session.name));
                }
            }
            for (const [id, record] of indexed) if (scope.has(record.sessionId)) indexed.delete(id);
            for (const [key, entry] of resources) if (scope.has(entry.sessionId)) resources.delete(key);
            for (const record of loaded.values()) {
                record.pinned = store.pinned(record.id);
                indexed.set(record.id, record);
            }
            while (indexed.size > 20000) indexed.delete(indexed.keys().next().value);
            return { sessionId: selected.id, artifacts: [...loaded.values()].map(publicRecord), warnings: [...new Set(warnings)],
                collectedAt: new Date().toISOString() };
        },
        async read(id, options = {}) {
            if (!options || typeof options !== "object" || Array.isArray(options) ||
                Object.keys(options).some((key) => key !== "version")) {
                throw sourceError("invalid_input", "Provide read options with an optional version.");
            }
            const { version } = options;
            const record = metadata(id);
            if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) {
                throw sourceError("invalid_input", "Version must be a positive integer.");
            }
            if (record.source === "published") {
                const note = version === undefined ? store.current(id) : store.revision(id, version);
                if (!note) throw sourceError("version_missing", "This captured revision does not exist.");
                return { metadata: published(note, record.sessionName), content: note.content, bytes: null,
                    mime: "text/markdown", filename: published(note, record.sessionName).name };
            }
            if (version !== undefined) throw sourceError("version_unavailable", "Discovered files do not have captured historical revisions.");
            const item = indexed.get(id);
            if (item.availability !== "available") throw sourceError("artifact_unavailable", item.reason);
            if (item.storage === "session") {
                const retained = await retainedImage(item.retainedAsset);
                return { metadata: record, content: null, bytes: retained.data, mime: retained.mime, filename: item.name };
            }
            return readInspected(item, record);
        },
        async readResource(id, ref, options = {}) {
            const path = localReference(ref);
            if (!path || !["image", "diagram"].includes(formats.get(extname(path).toLowerCase())?.[0])) {
                throw sourceError("invalid_input", "Choose a relative local image referenced by this document.");
            }
            if (metadata(id).mime !== "text/markdown") {
                throw sourceError("invalid_input", "Linked images require an indexed Markdown document.");
            }
            const anchor = indexed.get(id);
            const document = await catalog.read(id, options);
            if (document.mime !== "text/markdown" || document.content === null) {
                throw sourceError("invalid_input", "Linked images require an indexed Markdown document.");
            }
            const signature = digest(document.content);
            const key = `${id}:${document.metadata.sessionId}:${document.metadata.version ?? 0}`;
            let entry = resources.get(key);
            if (!entry || entry.signature !== signature) {
                const refs = markdownReferences(document.content);
                if (refs.size > 128) throw sourceError("resource_too_large", "A Markdown preview supports up to 128 local image references.");
                entry = { signature, sessionId: document.metadata.sessionId, refs, items: new Map(), budget: { bytes: 128 * TEXT_LIMIT, files: new Set() } };
                resources.set(key, entry);
                while (resources.size > 64) resources.delete(resources.keys().next().value);
            }
            if (!entry.refs.has(ref)) throw sourceError("resource_missing", "This image is not referenced by the Markdown document.");
            const parts = path.split("/").filter(part => part !== ".");
            if (parts.some(part => part.startsWith(".") || secret(part))) {
                throw sourceError("unsafe_path", "Hidden, sensitive, or parent-directory images are not loaded.");
            }
            if (document.metadata.source === "published") {
                const matches = [...indexed.values()].filter(item => item.sessionId === document.metadata.sessionId &&
                    item.name === parts.join("/") && ["image", "diagram"].includes(item.kind));
                if (matches.length !== 1) throw sourceError("resource_missing", "A saved note must reference one indexed image in its session by filename.");
                const image = matches[0];
                if (!entry.budget.files.has(image.id)) {
                    if (image.size > entry.budget.bytes) throw sourceError("resource_too_large", "Linked images exceed the 128 MiB document budget.");
                    entry.budget.bytes -= image.size; entry.budget.files.add(image.id);
                }
                return catalog.read(image.id);
            }
            const root = dirname(anchor.realPath);
            const target = resolve(root, ...parts);
            if (!within(root, target)) throw sourceError("unsafe_path", "Images outside this document's folder are not loaded.");
            if (!entry.items.has(target)) {
                const item = reference({ id: document.metadata.sessionId, name: document.metadata.sessionName }, target);
                entry.items.set(target, inspect(item, root, entry.budget, { rejectSymlinks: true }));
            }
            const image = await entry.items.get(target);
            if (image.availability !== "available") throw sourceError("resource_unavailable", image.reason);
            return readInspected(image);
        },
        revisions(id) { return metadata(id).source === "published" ? store.revisions(id) : []; },
        pin(id, pinned) {
            if (typeof pinned !== "boolean") throw sourceError("invalid_input", "Pinned must be a boolean.");
            metadata(id);
            store.pin(id, pinned);
            return metadata(id);
        },
        async publish(input) {
            if (!input || typeof input !== "object" || Array.isArray(input) ||
                Object.keys(input).some((key) => !["sessionId", "title", "content", "id", "expectedVersion"].includes(key)) ||
                typeof input.sessionId !== "string" ||
                typeof input.title !== "string" || !input.title.trim() || input.title.length > 200 ||
                typeof input.content !== "string" || Buffer.byteLength(input.content) > TEXT_LIMIT ||
                (input.id === undefined ? input.expectedVersion !== undefined :
                    typeof input.id !== "string" || !/^[a-f0-9]{64}$/.test(input.id) ||
                    !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1)) {
                throw sourceError("invalid_input", "Provide a session, a 1–200 character title, and Markdown up to 1 MiB. Updates require an ID and expectedVersion.");
            }
            sessions();
            if (snapshot.error) throw snapshot.error;
            const selected = snapshot.sessions.find((row) => row.id === input.sessionId || row.aliases.includes(input.sessionId));
            if (!selected) throw sourceError("session_missing", "Select a known session.");
            if (selected.location !== "local") throw sourceError("session_unavailable", "Publications require a local session.");
            const note = store.publish({ ...input, sessionId: selected.id, ownerSessionIds: [...new Set([selected.id, ...selected.aliases])] });
            const record = published(note, selected.name);
            indexed.set(record.id, record);
            return record;
        },
        close() { store.close(); },
    };
    return catalog;
}
