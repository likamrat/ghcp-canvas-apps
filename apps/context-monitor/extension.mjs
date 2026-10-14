import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import { readSnapshot } from "./source.mjs";
import { startServer } from "./server.mjs";
import { createSettings, settingsSchema } from "./settings.mjs";

const servers = new Map();
const settings = createSettings();
const emptyInput = { type: "object", properties: {}, additionalProperties: false };
function snapshot() {
    const preferences = settings.read();
    return { ...readSnapshot({ thresholds: preferences.thresholds }), settings: preferences };
}
function action(handler) {
    return (ctx) => {
        try { return handler(ctx); }
        catch (error) {
            throw new CanvasError(error.code ?? "context_monitor_error", error.message);
        }
    };
}
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
                    handler: action(snapshot),
                },
                {
                    name: "get_settings",
                    description: "Read saved warning and high-usage levels, built-in defaults, and the current settings version.",
                    inputSchema: emptyInput,
                    handler: action(() => settings.read()),
                },
                {
                    name: "set_thresholds",
                    description: "Save user-requested warning and high-usage percentages using the latest settings version. Use the defaults from get_settings to reset.",
                    inputSchema: settingsSchema,
                    handler: action((ctx) => settings.update(ctx.input)),
                },
            ],
            open: async (ctx) => {
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(snapshot, settings);
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
