import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import { createCatalog } from "./source.mjs";
import { queryImages, querySchema } from "./model.mjs";
import { startServer } from "./server.mjs";

const servers = new Map();
const catalog = createCatalog();
const emptyInput = { type: "object", properties: {}, additionalProperties: false };
const imageSchema = { type: "object", required: ["id"], additionalProperties: false, properties: { id: { type: "string", pattern: "^[a-f0-9]{64}$" } } };
const action = (handler) => async (ctx) => {
    try { return await handler(ctx); }
    catch (error) { throw new CanvasError(error.code ?? "screenshots_error", error.message); }
};

await joinSession({
    canvases: [createCanvas({
        id: "screenshots",
        displayName: "Screenshots",
        description: "Browse session uploads and tool-generated screenshots with filters, sorting, and full-size previews.",
        inputSchema: { ...emptyInput, properties: { sessionId: { type: "string", minLength: 1, maxLength: 128 } } },
        actions: [
            { name: "list_sessions", description: "Read local session names and hierarchy without reading conversation text.", inputSchema: emptyInput,
                handler: action(() => catalog.sessions()) },
            { name: "query_images", description: "Discover image references for one local session and optionally its children; return a filtered metadata page, not image bytes. Dates use this computer's local timezone.",
                inputSchema: querySchema, handler: action(async ({ input }) => {
                    const { sessionId, includeChildren, includeArchived, offset = 0, limit = 120, ...filters } = input;
                    queryImages([], filters);
                    catalog.sessions();
                    const result = await catalog.images(sessionId, { includeChildren, includeArchived });
                    const query = queryImages(result.images, filters);
                    return { sessionId: result.sessionId, images: query.images.slice(offset, offset + limit),
                        total: query.total, matching: query.images.length, offset, limit,
                        warnings: result.warnings, collectedAt: result.collectedAt };
                }) },
            { name: "get_image", description: "Read metadata for an image ID previously returned by query_images; does not return image bytes.", inputSchema: imageSchema,
                handler: action(({ input }) => catalog.metadata(input.id)) },
        ],
        open: async (ctx) => {
            let entry = servers.get(ctx.instanceId);
            if (!entry) {
                entry = await startServer(createCatalog(), ctx.input ?? {});
                servers.set(ctx.instanceId, entry);
            }
            return { title: "Screenshots", url: entry.url };
        },
        onClose: async ({ instanceId }) => {
            const entry = servers.get(instanceId);
            if (entry) { servers.delete(instanceId); await entry.close(); }
        },
    })],
});
