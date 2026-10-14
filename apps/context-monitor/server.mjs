import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const assets = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
    ["/model.mjs", ["model.mjs", "text/javascript; charset=utf-8"]],
    ["/style.css", ["style.css", "text/css; charset=utf-8"]],
    ["/fonts/Geist-Variable.woff2", ["fonts/Geist-Variable.woff2", "font/woff2"]],
    ["/fonts/GeistMono-Variable.woff2", ["fonts/GeistMono-Variable.woff2", "font/woff2"]],
]);

export async function startServer(snapshot, settings) {
    const token = randomBytes(32).toString("hex");
    const server = createServer(async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'");
        const origin = `http://127.0.0.1:${server.address().port}`;
        if (req.headers.host !== new URL(origin).host ||
            (req.headers.origin && req.headers.origin !== origin) ||
            req.headers["sec-fetch-site"] === "cross-site") {
            res.writeHead(403).end("Forbidden");
            return;
        }
        try {
            const url = new URL(req.url, origin);
            if (url.pathname === "/api/settings" && req.method === "POST" && settings) {
                if (req.headers["x-monitor-token"] !== token || req.headers["content-type"] !== "application/json") {
                    res.writeHead(403).end("Forbidden");
                    return;
                }
                let body = "";
                for await (const chunk of req) {
                    body += chunk;
                    if (Buffer.byteLength(body) > 4096) {
                        throw Object.assign(new Error("Settings request is too large."), { code: "invalid_input" });
                    }
                }
                let input;
                try { input = JSON.parse(body); }
                catch { throw Object.assign(new Error("Invalid settings JSON."), { code: "invalid_input" }); }
                const result = settings.update(input);
                res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
            } else if (req.method !== "GET") {
                res.writeHead(405, { Allow: "GET" }).end("Read-only monitor");
            } else if (assets.has(url.pathname)) {
                const [file, type] = assets.get(url.pathname);
                let content = await readFile(new URL(file, import.meta.url));
                if (file === "index.html") content = content.toString("utf8").replace("__TOKEN__", token);
                res.writeHead(200, { "Content-Type": type }).end(content);
            } else if (url.pathname === "/api/snapshot") {
                if (req.headers["x-monitor-token"] !== token) {
                    res.writeHead(403).end("Forbidden");
                    return;
                }
                const data = await snapshot();
                res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(data));
            } else if (url.pathname === "/favicon.ico") {
                res.writeHead(204).end();
            } else {
                res.writeHead(404).end("Not found");
            }
        } catch (error) {
            res.writeHead(error.code === "settings_changed" ? 409 : error.code === "invalid_input" ? 400 : 503,
                { "Content-Type": "application/json" })
                .end(JSON.stringify({ error: error.message, code: error.code ?? "monitor_unavailable", settings: error.settings }));
        }
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    return {
        url: `http://127.0.0.1:${server.address().port}/`,
        close: () => new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
            server.closeIdleConnections();
        }),
    };
}
