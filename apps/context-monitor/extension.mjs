import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import { readSnapshot } from "./source.mjs";
import { startServer } from "./server.mjs";

const servers = new Map();
const emptyInput = { type: "object", properties: {}, additionalProperties: false };
await joinSession({
    canvases: [
        createCanvas({
            id: "context-monitor",
            displayName: "Context Monitor",
            description: "See Copilot app sessions, nested children, models, and context usage in one read-only view.",
            inputSchema: emptyInput,
            actions: [
                {
                    name: "snapshot",
                    description: "Read current local app session metadata and context telemetry, including archived sessions.",
                    inputSchema: emptyInput,
                    handler: () => {
                        try { return readSnapshot(); }
                        catch (error) {
                            throw new CanvasError(error.code ?? "context_monitor_error", error.message);
                        }
                    },
                },
            ],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(readSnapshot);
                    servers.set(ctx.instanceId, entry);
                }
                return { title: "Context Monitor", url: entry.url };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await entry.close();
                }
            },
        }),
    ],
});
