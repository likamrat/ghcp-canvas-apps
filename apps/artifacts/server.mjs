import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createBrowserPopout } from "./browser.mjs";
import { inlineWordmark } from "./branding.mjs";

const assets = new Map([
    ["", ["index.html", "text/html; charset=utf-8"]],
    ...["app.js", "model.mjs", "render.mjs", "refresh.mjs", "browser.js", "multiselect.js"].map(name => [name, [name, "text/javascript; charset=utf-8"]]),
    ...["style.css", "multiselect.css", "branding.css"].map(name => [name, [name, "text/css; charset=utf-8"]]),
    ...["logo.svg", "icon.svg", "filter.svg", "refresh.svg"].map(name => [name, [name, "image/svg+xml"]]),
    ["icon.png", ["icon.png", "image/png"]],
    ["favicon.ico", ["icon.png", "image/png"]],
]);
const fail = (message, code = "invalid_input") => { throw Object.assign(new Error(message), { code }); };
function parameters(url, allowed) {
    for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) fail("Unsupported or repeated query parameter.");
    return url.searchParams;
}
function boolean(params, name) {
    const value = params.get(name);
    if (value !== null && !["true", "false"].includes(value)) fail("Scope values must be true or false.");
    return value === "true";
}
function version(params) {
    const value = params.get("version");
    if (value === null) return undefined;
    if (!/^[1-9]\d{0,8}$/.test(value)) fail("Choose a valid captured revision.");
    return Number(value);
}
async function body(req, allowed, maximum = 2 * 1024 * 1024) {
    if (req.headers["content-type"] !== "application/json") fail("Use a JSON request.");
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > maximum) fail("The request is too large.", "request_too_large");
        chunks.push(chunk);
    }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { fail("Invalid request JSON."); }
    if (!input || Array.isArray(input) || typeof input !== "object" || Object.keys(input).some(key => !allowed.includes(key))) fail("Unsupported request fields.");
    return input;
}
const disposition = name => `attachment; filename="artifact"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16)}`)}`;

export async function startServer(catalog, { sessionId, launchBrowser } = {}) {
    const prefix = `/${randomBytes(32).toString("hex")}/`;
    let scanning = false;
    const popout = createBrowserPopout(() => `http://127.0.0.1:${server.address().port}${prefix}`, launchBrowser);
    const server = createServer(async (req, res) => {
        const origin = `http://127.0.0.1:${server.address().port}`;
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'");
        const json = value => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(value));
        try {
            const url = new URL(req.url, origin);
            const staticRequest = req.method === "GET" && url.pathname.startsWith(prefix) && assets.has(url.pathname.slice(prefix.length));
            if (req.headers.host !== new URL(origin).host ||
                (!staticRequest && ((req.headers.origin && req.headers.origin !== origin) || req.headers["sec-fetch-site"] === "cross-site"))) {
                res.writeHead(403).end("Forbidden"); return;
            }
            if (!url.pathname.startsWith(prefix)) { res.writeHead(403).end("Forbidden"); return; }
            const route = url.pathname.slice(prefix.length);
            if (req.method === "POST") {
                if (route === "api/open-browser") { json(await popout.open(req)); return; }
                if (route === "api/publish") {
                    const input = await body(req, ["sessionId", "title", "content", "id", "expectedVersion"]);
                    json(await catalog.publish(input)); return;
                }
                if (route === "api/pin") {
                    const input = await body(req, ["id", "pinned"], 2048);
                    json(await catalog.pin(input.id, input.pinned)); return;
                }
                res.writeHead(404).end("Not found"); return;
            }
            if (req.method !== "GET") { res.writeHead(405, { Allow: "GET, POST" }).end("Method not allowed"); return; }
            if (assets.has(route)) {
                const [path, mime] = assets.get(route);
                let content = await readFile(new URL(path, import.meta.url));
                if (path === "index.html") {
                    const icon = await readFile(new URL("icon.svg", import.meta.url));
                    const wordmark = inlineWordmark(await readFile(new URL("logo.svg", import.meta.url), "utf8"));
                    content = content.toString("utf8")
                        .replace("__ICON_VERSION__", createHash("sha256").update(icon).digest("hex").slice(0, 12))
                        .replace("__APP_WORDMARK__", wordmark);
                }
                res.writeHead(200, { "Content-Type": mime }).end(content); return;
            }
            if (route === "api/sessions") {
                const params = parameters(url, ["sessionId"]);
                json(await catalog.sessions(params.get("sessionId") || sessionId)); return;
            }
            if (route === "api/artifacts") {
                const params = parameters(url, ["sessionId", "includeChildren", "includeArchived"]);
                const selected = params.get("sessionId");
                if (!selected || selected.length > 128) fail("Choose a session.");
                const scope = { includeChildren: boolean(params, "includeChildren"), includeArchived: boolean(params, "includeArchived") };
                if (scanning) fail("Artifact discovery is still running. Retry when it finishes.", "source_busy");
                scanning = true;
                try { json(await catalog.artifacts(selected, scope)); } finally { scanning = false; }
                return;
            }
            const match = route.match(/^(api\/content|api\/revisions|file)\/([a-f0-9]{64})$/);
            if (match) {
                const [, operation, id] = match;
                const params = parameters(url, operation === "api/revisions" ? [] : ["version", "download"]);
                const revision = version(params);
                if (operation === "api/revisions") { json(await catalog.revisions(id)); return; }
                const result = await catalog.read(id, { version: revision });
                if (operation === "api/content") {
                    json({ ...result, bytes: undefined, revisions: await catalog.revisions(id) }); return;
                }
                const bytes = result.bytes ?? Buffer.from(result.content ?? "", "utf8");
                const preview = ["image", "diagram"].includes(result.metadata.kind) && !boolean(params, "download");
                res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'");
                res.writeHead(200, {
                    "Content-Type": result.mime,
                    "Content-Length": bytes.length,
                    "Content-Disposition": preview ? "inline" : disposition(result.filename),
                }).end(bytes);
                return;
            }
            res.writeHead(404).end("Not found");
        } catch (error) {
            const code = error.code ?? "artifacts_unavailable";
            const status = error.status ?? (code === "invalid_input" ? 400 : /too_large/.test(code) ? 413 :
                /conflict|stale|changed/.test(code) ? 409 : /missing|not_found|ENOENT/.test(code) ? 404 : 503);
            if (!res.headersSent) res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: error.message, code }));
            else res.destroy(error);
        }
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    return {
        url: `http://127.0.0.1:${server.address().port}${prefix}${sessionId ? `?session=${encodeURIComponent(sessionId)}` : ""}`,
        hasBrowserWindow: popout.hasBrowserWindow,
        close: () => new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
            server.closeAllConnections();
        }),
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const { createCatalog } = await import("./source.mjs");
    const catalog = createCatalog();
    const server = await startServer(catalog, { sessionId: process.argv[2] });
    console.log(`Artifacts: ${server.url}`);
    let closing = false;
    const close = async () => {
        if (closing) return;
        closing = true;
        await server.close();
        catalog.close();
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
}
