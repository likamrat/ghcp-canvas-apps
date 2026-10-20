import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const routes = new Map([
    ["/", ["./index.html", "text/html; charset=utf-8"]],
    ["/app.js", ["./app.js", "text/javascript; charset=utf-8"]],
    ["/style.css", ["./style.css", "text/css; charset=utf-8"]],
    ["/favicon.svg", ["./favicon.svg", "image/svg+xml"]],
    ["/font.woff2", ["../context-monitor/fonts/Geist-Variable.woff2", "font/woff2"]],
    ["/reference.png", ["../screenshots/screenshot.png", "image/png"]],
]);
const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const route = routes.get(url.pathname);
    if (req.method !== "GET" || !route) {
        res.writeHead(404).end("Not found");
        return;
    }
    try {
        const bytes = await readFile(new URL(route[0], import.meta.url));
        res.writeHead(200, {
            "Content-Type": route[1],
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'none'",
        }).end(bytes);
    } catch (error) {
        console.error(error);
        res.writeHead(500).end("Could not load the prototype asset.");
    }
});
server.listen(Number(process.env.PORT || 4318), "127.0.0.1", () => {
    console.log(`Artifact workspace mock: http://127.0.0.1:${server.address().port}/?variant=A`);
});
