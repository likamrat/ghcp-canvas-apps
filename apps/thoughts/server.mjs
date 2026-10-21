import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { createBrowserPopout } from "./browser.mjs";
import { inlineWordmark } from "./branding.mjs";

const assets = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
    ["/style.css", ["style.css", "text/css; charset=utf-8"]],
    ["/branding.css", ["branding.css", "text/css; charset=utf-8"]],
    ["/filter.svg", ["filter.svg", "image/svg+xml"]],
    ["/refresh.svg", ["refresh.svg", "image/svg+xml"]],
    ["/ui-icons.svg", ["ui-icons.svg", "image/svg+xml"]],
    ["/browser.js", ["browser.js", "text/javascript; charset=utf-8"]],
    ["/icon.png", ["icon.png", "image/png"]],
    ["/icon.svg", ["icon.svg", "image/svg+xml"]],
    ["/favicon.ico", ["icon.png", "image/png"]],
]);

export async function startServer(store, { launchBrowser } = {}) {
    const token = randomBytes(32).toString("hex");
    const popout = createBrowserPopout(() => `http://127.0.0.1:${server.address().port}/`, launchBrowser);
    const server = createServer(async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'");
        const address = server.address();
        const expectedHost = `127.0.0.1:${address.port}`;
        const origin = `http://${expectedHost}`;
        if (req.headers.host !== expectedHost ||
            (req.headers.origin && req.headers.origin !== origin) || req.headers["sec-fetch-site"] === "cross-site") {
            res.writeHead(403).end("Forbidden");
            return;
        }
        try {
            const url = new URL(req.url, origin);
            if (url.pathname === "/api/open-browser" && req.method === "POST") {
                if (req.headers["x-inbox-token"] !== token) { res.writeHead(403).end("Forbidden"); return; }
                const result = await popout.open(req);
                res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
                return;
            }
            if (req.method === "GET" && assets.has(url.pathname)) {
                const [file, type] = assets.get(url.pathname);
                let content = await readFile(new URL(file, import.meta.url));
                if (file === "index.html") {
                    const icon = await readFile(new URL("icon.svg", import.meta.url));
                    content = content.toString("utf8").replace("__TOKEN__", token)
                        .replace("__ICON_VERSION__", createHash("sha256").update(icon).digest("hex").slice(0, 12))
                        .replace("__APP_WORDMARK__", inlineWordmark(await readFile(new URL("logo.svg", import.meta.url), "utf8")));
                }
                res.setHeader("Content-Type", type);
                res.end(content);
                return;
            }
            if (url.pathname === "/api" && req.method === "POST") {
                if (req.headers["x-inbox-token"] !== token ||
                    req.headers["content-type"] !== "application/json") {
                    res.writeHead(403).end("Forbidden");
                    return;
                }
                let body = "";
                for await (const chunk of req) {
                    body += chunk;
                    if (Buffer.byteLength(body) > 20000) {
                        throw Object.assign(new Error("Request too large."), { code: "invalid_input" });
                    }
                }
                let payload;
                try { payload = JSON.parse(body); }
                catch { throw Object.assign(new Error("Invalid JSON."), { code: "invalid_input" }); }
                const result = store.run(payload?.action, payload?.input);
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify(result));
                return;
            }
            res.writeHead(404).end("Not found");
        } catch (error) {
            res.writeHead(error.status ?? (error.code === "item_changed" ? 409 : error.code === "invalid_input" ? 400 : 500),
                { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: error.message }));
        }
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    return {
        hasBrowserWindow: popout.hasBrowserWindow,
        server,
        url: `http://127.0.0.1:${server.address().port}/`,
        close: () => new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
            server.closeIdleConnections();
        }),
    };
}
