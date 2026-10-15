import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./server.mjs";

test("loopback service requires a capability URL and rejects foreign origins and arbitrary paths", async (t) => {
    const catalog = {
        sessions: () => ({ sessions: [{ id: "session", name: "Test" }], warnings: [] }),
        images: async () => ({ images: [], warnings: [] }),
    };
    const server = await startServer(catalog);
    t.after(() => server.close());
    const origin = new URL(server.url).origin;
    assert.equal((await fetch(origin)).status, 403);
    assert.equal((await fetch(server.url)).status, 200);
    assert.equal((await fetch(new URL("api/sessions", server.url))).status, 200);
    assert.equal((await fetch(new URL("api/sessions", server.url), { headers: { Origin: "https://example.com" } })).status, 403);
    assert.equal((await fetch(new URL("api/sessions", server.url), { method: "POST" })).status, 405);
    assert.equal((await fetch(new URL("image/..%2fprivate.png", server.url))).status, 404);
    assert.equal((await fetch(new URL("api/images?sessionId=session&includeChildren=perhaps", server.url))).status, 400);
    assert.equal((await fetch(new URL("api/images?sessionId=session&path=secret", server.url))).status, 400);
});
