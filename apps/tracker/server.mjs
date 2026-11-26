import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { inlineWordmark } from "./branding.mjs";
import { launchBrowserWindow } from "./browser.mjs";
import { TrackerError } from "./store.mjs";

const assets = new Map([
    ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
    ["/style.css", ["style.css", "text/css; charset=utf-8"]],
    ["/branding.css", ["branding.css", "text/css; charset=utf-8"]],
    ...["filter", "refresh", "ui-icons", "icon"].map(name => [`/${name}.svg`, [`${name}.svg`, "image/svg+xml"]]),
    ["/favicon.ico", ["icon.png", "image/png"]],
]);
const read = (name) => readFile(new URL(name, import.meta.url));
const reply = (res, status, data) =>
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(data));

async function readInput(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > 512 * 1024) {
            req.resume();
            throw new TrackerError("invalid_input", "Tracker request is too large.", 413);
        }
        chunks.push(chunk);
    }
    let input;
    try {
        input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        throw new TrackerError("invalid_input", "Tracker request must contain valid JSON.", 400);
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new TrackerError("invalid_input", "Tracker request must be an object.", 400);
    }
    return input;
}

export async function startServer(store, { launchBrowser = launchBrowserWindow, currentSessionId } = {}) {
    const token = randomBytes(32).toString("hex");
    const [html, logo, icon] = await Promise.all(["index.html", "logo.svg", "icon.svg"].map(read));
    const page = html.toString().replace("__TOKEN__", token)
        .replace("__ICON_VERSION__", createHash("sha256").update(icon).digest("hex").slice(0, 12))
        .replace("__APP_WORDMARK__", inlineWordmark(logo.toString()));
    let openedInBrowser = false;
    const server = createServer(async (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Content-Security-Policy",
            "default-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'");
        const host = `127.0.0.1:${server.address().port}`;
        const origin = `http://${host}`;
        if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== origin) ||
            req.headers["sec-fetch-site"] === "cross-site") {
            return reply(res, 403, { error: "Tracker only accepts requests from its local view." });
        }
        try {
            const { pathname } = new URL(req.url, origin);
            if (req.method === "GET" && pathname === "/") {
                return res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page);
            }
            if (req.method === "GET" && assets.has(pathname)) {
                const [file, type] = assets.get(pathname);
                const data = await read(file);
                return res.writeHead(200, { "Content-Type": type }).end(data);
            }
            if (req.method === "POST" && ["/api", "/api/open-browser", "/api/delete-board"].includes(pathname)) {
                if (req.headers["x-tracker-token"] !== token || req.headers["content-type"] !== "application/json") {
                    return reply(res, 403, { error: "Tracker rejected the request. Reload this view and try again." });
                }
                const input = await readInput(req);
                if (pathname === "/api") return reply(res, 200, store.run(input.action, input.input, currentSessionId));
                if (pathname === "/api/delete-board") return reply(res, 200, store.deleteBoard(input));
                const board = store.resolveOpen(input);
                const url = new URL(origin);
                url.searchParams.set("view", "browser");
                if (board) url.searchParams.set("board", board.id);
                const result = await launchBrowser(url.href);
                openedInBrowser = true;
                return reply(res, 200, result);
            }
            reply(res, 404, { error: "Tracker route not found." });
        } catch (error) {
            if (error instanceof TrackerError || error.code === "browser_launch_failed" || error.code === "browser_unavailable") {
                return reply(res, error.status, { code: error.code, error: error.message });
            }
            console.error("Tracker:", error);
            reply(res, 500, { error: "Tracker could not load or save your work. Try again." });
        }
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    return {
        url: `http://127.0.0.1:${server.address().port}/`,
        hasBrowserWindow: () => openedInBrowser,
        close: () => new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
            server.closeIdleConnections();
        }),
    };
}
