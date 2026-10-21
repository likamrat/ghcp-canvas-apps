import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { sourceError } from "./source.mjs";
import { attachment, downloadArchive, saveImages, revealDownload } from "./downloads.mjs";
import { createBrowserPopout } from "./browser.mjs";
import { inlineWordmark } from "./branding.mjs";

const assets = new Map([
    ["", ["index.html", "text/html; charset=utf-8"]],
    ["app.js", ["app.js", "text/javascript; charset=utf-8"]],
    ["model.mjs", ["model.mjs", "text/javascript; charset=utf-8"]],
    ["refresh.mjs", ["refresh.mjs", "text/javascript; charset=utf-8"]],
    ["style.css", ["style.css", "text/css; charset=utf-8"]],
    ["branding.css", ["branding.css", "text/css; charset=utf-8"]],
    ["filter.svg", ["filter.svg", "image/svg+xml"]],
    ["refresh.svg", ["refresh.svg", "image/svg+xml"]],
    ["ui-icons.svg", ["ui-icons.svg", "image/svg+xml"]],
    ["multiselect.js", ["multiselect.js", "text/javascript; charset=utf-8"]],
    ["multiselect.css", ["multiselect.css", "text/css; charset=utf-8"]],
    ["icons/download.svg", ["icons/download.svg", "image/svg+xml"]],
    ["browser.js", ["browser.js", "text/javascript; charset=utf-8"]],
    ["icon.svg", ["icon.svg", "image/svg+xml"]],
    ["icon.png", ["icon.png", "image/png"]],
    ["favicon.svg", ["icon.svg", "image/svg+xml"]],
    ["favicon.ico", ["icon.png", "image/png"]],
]);

function imageInput(params) {
    const allowed = new Set(["sessionId", "includeChildren", "includeArchived"]);
    for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) throw sourceError("invalid_input", "Unsupported or repeated query parameter.");
    const sessionId = params.get("sessionId");
    if (!sessionId || sessionId.length > 128) throw sourceError("invalid_input", "Choose a session.");
    const input = {};
    for (const key of ["includeChildren", "includeArchived"]) {
        const value = params.get(key);
        if (value !== null && !["true", "false"].includes(value)) throw sourceError("invalid_input", "Scope values must be true or false.");
        input[key] = value === "true";
    }
    return { sessionId, input };
}

export async function startServer(catalog, { sessionId, downloadDirectory, launchBrowser, revealFile = revealDownload } = {}) {
    const token = randomBytes(32).toString("hex");
    const prefix = `/${token}/`;
    let scanning = false;
    let exporting = false;
    const savedDownloads = new Map();
    const popout = createBrowserPopout(() => `http://127.0.0.1:${server.address().port}${prefix}`, launchBrowser);
    const server = createServer(async (req, res) => {
        const origin = `http://127.0.0.1:${server.address().port}`;
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Content-Security-Policy",
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'");
        if (req.headers.host !== new URL(origin).host ||
            (req.headers.origin && req.headers.origin !== origin) ||
            req.headers["sec-fetch-site"] === "cross-site") {
            res.writeHead(403).end("Forbidden");
            return;
        }
        let image;
        try {
            const url = new URL(req.url, origin);
            if (!url.pathname.startsWith(prefix)) { res.writeHead(403).end("Forbidden"); return; }
            const route = url.pathname.slice(prefix.length);
            if (route === "api/open-browser" && req.method === "POST") {
                const result = await popout.open(req);
                res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
                return;
            }
            if (route === "api/open-download-folder" && req.method === "POST") {
                if (req.headers["content-type"] !== "application/json") throw sourceError("invalid_input", "Use a JSON download reference.");
                let body = "";
                for await (const chunk of req) {
                    body += chunk;
                    if (Buffer.byteLength(body) > 1024) throw sourceError("invalid_input", "The download reference is too large.");
                }
                let input;
                try { input = JSON.parse(body); } catch { throw sourceError("invalid_input", "Invalid download reference JSON."); }
                if (!input || typeof input !== "object" || Object.keys(input).length !== 1 ||
                    typeof input.downloadId !== "string" || !/^[a-f0-9]{32}$/.test(input.downloadId)) {
                    throw sourceError("invalid_input", "Choose a completed download from this app.");
                }
                const path = savedDownloads.get(input.downloadId);
                if (!path) throw sourceError("download_missing", "This download is no longer tracked. Download the file again to reveal it.");
                const result = await revealFile(path);
                res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
                return;
            }
            if (["api/download-all", "api/save-download"].includes(route) && req.method === "POST") {
                if (req.headers["content-type"] !== "application/json") throw sourceError("invalid_input", "Use a JSON image selection.");
                if (exporting) throw sourceError("export_busy", "A download archive is already being prepared.");
                exporting = true;
                try {
                    let body = "";
                    for await (const chunk of req) {
                        body += chunk;
                        if (Buffer.byteLength(body) > 700000) throw sourceError("invalid_input", "The download selection is too large.");
                    }
                    let input;
                    try { input = JSON.parse(body); } catch { throw sourceError("invalid_input", "Invalid download selection JSON."); }
                    if (route === "api/save-download") {
                        const saved = await saveImages(catalog, input, downloadDirectory);
                        const downloadId = randomBytes(16).toString("hex");
                        savedDownloads.set(downloadId, saved.path);
                        if (savedDownloads.size > 1000) savedDownloads.delete(savedDownloads.keys().next().value);
                        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ...saved, downloadId }));
                        return;
                    }
                    if (!input || typeof input !== "object" || Object.keys(input).some((key) => key !== "ids")) throw sourceError("invalid_input", "Unsupported download selection.");
                    const archive = await downloadArchive(catalog, input.ids);
                    res.writeHead(200, { "Content-Type": "application/zip", "Content-Length": archive.length,
                        "Content-Disposition": attachment("screenshots.zip") }).end(archive);
                } finally { exporting = false; }
                return;
            }
            if (req.method !== "GET") { res.writeHead(405, { Allow: "GET" }).end("Read-only screenshots"); return; }
            if (assets.has(route)) {
                const [file, mime] = assets.get(route);
                let content = await readFile(new URL(file, import.meta.url));
                if (file === "index.html") {
                    const icon = await readFile(new URL("icon.svg", import.meta.url));
                    content = content.toString("utf8").replace("__ICON_VERSION__", createHash("sha256").update(icon).digest("hex").slice(0, 12))
                        .replace("__APP_WORDMARK__", inlineWordmark(await readFile(new URL("logo.svg", import.meta.url), "utf8")));
                }
                res.writeHead(200, { "Content-Type": mime }).end(content);
            } else if (route === "api/sessions") {
                const requested = url.searchParams.get("sessionId") || sessionId;
                res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(catalog.sessions(requested)));
            } else if (route === "api/images") {
                const { sessionId, input } = imageInput(url.searchParams);
                if (scanning) throw sourceError("source_busy", "Image discovery is still running. Retry when it finishes.");
                scanning = true;
                let result;
                try { result = await catalog.images(sessionId, input); }
                finally { scanning = false; }
                res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
            } else if (/^(?:image|download)\/[a-f0-9]{64}$/.test(route)) {
                const id = route.split("/")[1];
                const download = route.startsWith("download/");
                const metadata = download ? catalog.metadata(id) : null;
                image = await catalog.openImage(id);
                res.writeHead(200, { "Content-Type": image.mime, "Content-Length": image.size,
                    "Content-Disposition": download ? attachment(metadata.name) : "inline" });
                if (image.data) res.end(image.data);
                else await pipeline(image.file.createReadStream({ autoClose: false }), res);
            } else {
                res.writeHead(404).end("Not found");
            }
        } catch (error) {
            if (!res.headersSent) {
                const status = error.status ?? (error.code === "invalid_input" ? 400 : error.code === "export_too_large" ? 413 : ["session_missing", "image_missing", "download_missing", "ENOENT"].includes(error.code) ? 404 :
                    error.code === "image_changed" ? 409 : 503);
                res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: error.message, code: error.code ?? "screenshots_unavailable" }));
            } else res.destroy(error);
        } finally { await image?.file?.close(); }
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    return {
        hasBrowserWindow: popout.hasBrowserWindow,
        url: `http://127.0.0.1:${server.address().port}${prefix}${sessionId ? `?session=${encodeURIComponent(sessionId)}` : ""}`,
        close: () => new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
            server.closeAllConnections();
        }),
    };
}
