import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import { createCatalog } from "./source.mjs";
import { queryArtifacts, KINDS, SOURCES } from "./model.mjs";
import { startServer } from "./server.mjs";

const catalog = createCatalog();
const servers = new Map();
const empty = { type: "object", properties: {}, additionalProperties: false };
const id = { type: "string", pattern: "^[a-f0-9]{64}$" };
const sessionId = { type: "string", minLength: 1, maxLength: 128 };
const handler = callback => async context => {
    try { return await callback(context); }
    catch (error) { throw new CanvasError(error.code ?? "artifacts_error", error.message); }
};
const canvas = createCanvas({
    id: "artifacts",
    displayName: "Artifacts",
    description: "Browse local session artifacts, preview documents and images, and publish notes with captured revisions.",
    inputSchema: { ...empty, properties: { sessionId } },
    actions: [
        { name: "list_sessions", description: "List local session names and hierarchy.", inputSchema: empty,
            handler: handler(({ sessionId }) => catalog.sessions(sessionId)) },
        { name: "query_artifacts", description: "Discover artifacts in a session and optionally its children; return filtered metadata, not file bytes.",
            inputSchema: { ...empty, required: ["sessionId"], properties: {
                sessionId, includeChildren: { type: "boolean" }, includeArchived: { type: "boolean" },
                search: { type: "string", maxLength: 500 }, pinned: { type: "boolean" },
                kinds: { type: "array", items: { enum: Object.keys(KINDS) }, uniqueItems: true },
                sources: { type: "array", items: { enum: Object.keys(SOURCES) }, uniqueItems: true },
                from: { type: "string", maxLength: 10 }, to: { type: "string", maxLength: 10 },
                sort: { enum: ["timestamp", "name", "size"] }, order: { enum: ["asc", "desc"] },
                offset: { type: "integer", minimum: 0, maximum: 10000 }, limit: { type: "integer", minimum: 1, maximum: 100 },
            } },
            handler: handler(async ({ input }) => {
                const { sessionId, includeChildren, includeArchived, offset = 0, limit = 16, ...filters } = input;
                queryArtifacts([], filters);
                const result = await catalog.artifacts(sessionId, { includeChildren, includeArchived });
                const matching = queryArtifacts(result.artifacts, filters);
                return { sessionId: result.sessionId, artifacts: matching.slice(offset, offset + limit), total: result.artifacts.length,
                    matching: matching.length, offset, limit, warnings: result.warnings, collectedAt: result.collectedAt };
            }) },
        { name: "get_artifact", description: "Read metadata for an artifact from the loaded catalog.",
            inputSchema: { ...empty, required: ["id"], properties: { id } },
            handler: handler(({ input }) => catalog.metadata(input.id)) },
        { name: "read_artifact", description: "Read a bounded text page from a loaded artifact or captured note revision. Binary content is not returned.",
            inputSchema: { ...empty, required: ["id"], properties: {
                id, version: { type: "integer", minimum: 1 }, offset: { type: "integer", minimum: 0 },
                limit: { type: "integer", minimum: 1, maximum: 20000 },
            } },
            handler: handler(async ({ input: { id, version, offset = 0, limit = 10000 } }) => {
                const result = await catalog.read(id, { version });
                return { metadata: result.metadata, content: result.content?.slice(offset, offset + limit) ?? null,
                    offset, totalCharacters: result.content?.length ?? 0, more: (result.content?.length ?? 0) > offset + limit };
            }) },
        { name: "register_artifact", description: "Publish a Markdown note in a local session. Updating an existing note requires its ID and expected version; original files are never changed.",
            inputSchema: { ...empty, required: ["title", "content"], properties: {
                sessionId, title: { type: "string", minLength: 1, maxLength: 200 },
                content: { type: "string", maxLength: 1048576 }, id, expectedVersion: { type: "integer", minimum: 1 },
            } },
            handler: handler(({ input, sessionId }) => catalog.publish({ ...input, sessionId: input.sessionId ?? sessionId })) },
        { name: "list_revisions", description: "List captured publication revisions; ordinary discovered files have no reconstructed history.",
            inputSchema: { ...empty, required: ["id"], properties: { id } },
            handler: handler(({ input }) => catalog.revisions(input.id)) },
        { name: "set_pinned", description: "Pin or unpin a loaded artifact without changing its original file.",
            inputSchema: { ...empty, required: ["id", "pinned"], properties: { id, pinned: { type: "boolean" } } },
            handler: handler(({ input }) => catalog.pin(input.id, input.pinned)) },
    ],
    open: async context => {
        let entry = servers.get(context.instanceId);
        if (!entry) {
            const source = createCatalog();
            try {
                entry = { ...await startServer(source, { sessionId: context.input?.sessionId ?? context.sessionId }), source };
                servers.set(context.instanceId, entry);
            } catch (error) { source.close(); throw error; }
        }
        return { title: "Artifacts", url: entry.url };
    },
    onClose: async ({ instanceId }) => {
        const entry = servers.get(instanceId);
        if (entry && !entry.hasBrowserWindow()) {
            servers.delete(instanceId);
            await entry.close();
            entry.source.close();
        }
    },
});
canvas.declaration.icon = "icon.png";
await joinSession({ canvases: [canvas] });
