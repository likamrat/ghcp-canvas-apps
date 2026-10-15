import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

function failure(code, message, status = 503) { return Object.assign(new Error(message), { code, status }); }

export function browserCommand(value, { platform = process.platform, env = process.env, exists = existsSync } = {}) {
    const url = new URL(value);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password) {
        throw failure("invalid_input", "Only this app's local browser URL may be opened.", 400);
    }
    const candidates = platform === "win32" ? [
        [env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"],
        [env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"],
        [env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe"],
        [env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe"],
        [env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"],
    ].filter((parts) => parts[0]).map((parts) => join(...parts)) : platform === "darwin" ? [
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ] : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
    const executable = candidates.find(exists);
    if (executable) return { executable, args: [`--app=${url.href}`, "--new-window"], mode: "window",
        browser: /edge/i.test(executable) ? "Microsoft Edge" : /chrome/i.test(executable) ? "Google Chrome" : "Chromium" };
    const fallback = platform === "win32" ? join(env.WINDIR || "C:\\Windows", "explorer.exe")
        : platform === "darwin" ? "/usr/bin/open" : "/usr/bin/xdg-open";
    if (!exists(fallback)) throw failure("browser_unavailable", "No supported browser launcher was found.");
    return { executable: fallback, args: [url.href], mode: "browser", browser: "your default browser" };
}

export async function launchBrowserWindow(url) {
    const command = browserCommand(url);
    await new Promise((resolve, reject) => {
        const child = spawn(command.executable, command.args, { stdio: "ignore", windowsHide: true, detached: true, shell: false });
        let timer, settled = false;
        const finish = (error) => {
            if (settled) return;
            settled = true; clearTimeout(timer); child.unref();
            if (error) reject(failure("browser_launch_failed", `Could not open the browser: ${error.message}`)); else resolve();
        };
        child.once("error", finish);
        child.once("spawn", () => { timer = setTimeout(() => finish(), 750); });
        child.once("exit", (code) => finish(code ? new Error(`launcher exited with code ${code}`) : undefined));
    });
    return { mode: command.mode, browser: command.browser };
}

export function createBrowserPopout(getUrl, launch = launchBrowserWindow) {
    let opened = false, opening = false;
    return {
        hasBrowserWindow: () => opened,
        async open(req) {
            if (req.headers["x-canvas-popout"] !== "1" || req.headers["content-type"] !== "application/json") {
                throw failure("forbidden", "Browser launch requires an explicit app button request.", 403);
            }
            if (opening) throw failure("browser_busy", "A browser window is already opening.");
            let body = "";
            for await (const chunk of req) {
                body += chunk;
                if (Buffer.byteLength(body) > 1024) throw failure("invalid_input", "Browser request is too large.", 400);
            }
            let input;
            try { input = JSON.parse(body); } catch { throw failure("invalid_input", "Invalid browser request.", 400); }
            if (!input || Array.isArray(input) || typeof input !== "object" || Object.keys(input).some((key) => key !== "sessionId") ||
                (input.sessionId !== undefined && (typeof input.sessionId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(input.sessionId)))) {
                throw failure("invalid_input", "Unsupported browser request.", 400);
            }
            if (opening) throw failure("browser_busy", "A browser window is already opening.");
            opening = true;
            try {
                const url = new URL(getUrl());
                url.searchParams.set("view", "browser");
                if (input.sessionId) url.searchParams.set("session", input.sessionId);
                const result = await launch(url.href);
                opened = true;
                return result;
            } finally { opening = false; }
        },
    };
}
