import { CanvasError, createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { actions, createStore, openSchema, TrackerError } from "./store.mjs";
import { startServer } from "./server.mjs";

let store;
const getStore = () => store ??= createStore();
const servers = new Map();

async function respond(run) {
    try {
        return await run();
    } catch (error) {
        if (error instanceof TrackerError) throw new CanvasError(error.code, error.message);
        console.error("Tracker:", error);
        throw new CanvasError("tracker_unavailable", "Tracker could not access its local store. Try again.");
    }
}

const canvas = createCanvas({
    id: "work-tracker",
    displayName: "Tracker",
    description: "Open, create, and update named work trackers shared across your local Copilot chats.",
    inputSchema: openSchema,
    actions: Object.entries(actions).map(([name, [description, inputSchema]]) => ({
        name, description, inputSchema,
        handler: ({ input, sessionId }) => respond(() => getStore().run(name, input ?? {}, sessionId)),
    })),
    open: ({ instanceId, input, sessionId }) => respond(async () => {
        const tracker = getStore();
        const board = tracker.resolveOpen(input ?? {});
        let entry = servers.get(instanceId);
        if (!entry) {
            entry = startServer(tracker, { currentSessionId: sessionId });
            servers.set(instanceId, entry);
            entry.catch(() => { if (servers.get(instanceId) === entry) servers.delete(instanceId); });
        }
        const url = new URL((await entry).url);
        if (board) url.searchParams.set("board", board.id);
        return { title: "Tracker", url: url.href };
    }),
    onClose: async ({ instanceId }) => {
        const entry = servers.get(instanceId);
        servers.delete(instanceId);
        if (entry) {
            const server = await entry;
            if (!server.hasBrowserWindow()) await server.close();
        }
    },
});

canvas.declaration.icon = "icon.png";
await joinSession({ canvases: [canvas] });
