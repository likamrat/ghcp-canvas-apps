import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import { createStore, actionSchemas } from "./store.mjs";
import { startServer } from "./server.mjs";

const store = createStore();
const servers = new Map();
const canvas = createCanvas({
            id: "idea-inbox",
            displayName: "Thoughts",
            description: "Capture, revisit and complete personal thoughts in one saved list shared across chats.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
            actions: Object.entries(actionSchemas).map(([name, inputSchema]) => ({
                name,
                description: {
                    list: "Read the saved personal list and item versions.",
                    add: "Save a thought when the user asks; never capture chat content automatically.",
                    update: "Edit text or done status using the item's latest version; stale changes are rejected.",
                    delete: "Permanently delete a thought only on explicit user request, using its current version.",
                }[name],
                inputSchema,
                handler: (ctx) => {
                    try {
                        return store.run(name, ctx.input ?? {});
                    } catch (error) {
                        throw new CanvasError(error.code ?? "idea_inbox_error", error.message);
                    }
                },
            })),
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(store);
                    servers.set(ctx.instanceId, entry);
                }
                return { title: "Thoughts", url: entry.url };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await entry.close();
                }
            },
        });
// The runtime supports PNG icon metadata; this SDK's factory does not yet copy it.
canvas.declaration.icon = "icon.png";
await joinSession({ canvases: [canvas] });
