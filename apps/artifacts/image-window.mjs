import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { win32 } from "node:path";

const failure = (message) => Object.assign(new Error(message), { code: "image_window_unavailable" });

export function imageWindowCommand(value, { platform = process.platform, env = process.env, exists = existsSync } = {}) {
    const url = new URL(value);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password) {
        throw failure("Only a local artifact image window may be opened.");
    }
    let candidates;
    if (platform === "win32") {
        candidates = [env["ProgramFiles(x86)"], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean)
            .flatMap(root => [win32.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
                win32.join(root, "Google", "Chrome", "Application", "chrome.exe")]);
    } else if (platform === "darwin") {
        candidates = ["/Applications/Microsoft Edge.app", "/Applications/Google Chrome.app", "/Applications/Chromium.app"];
    } else {
        candidates = ["/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
    }
    const browser = candidates.find(exists);
    if (!browser) throw failure("An image-only window requires Microsoft Edge, Google Chrome, or Chromium installed in its standard location.");
    const args = [`--app=${url.href}`, "--window-size=1100,800"];
    return platform === "darwin" ? { executable: "/usr/bin/open", args: ["-a", browser, "--args", ...args] }
        : { executable: browser, args };
}

export async function launchImageWindow(url) {
    const command = imageWindowCommand(url);
    await new Promise((resolve, reject) => {
        const child = spawn(command.executable, command.args, { stdio: "ignore", detached: true, shell: false });
        let timer, settled = false;
        const finish = error => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            child.unref();
            if (error) reject(failure(`Could not open the image window: ${error.message}`));
            else resolve();
        };
        child.once("error", finish);
        child.once("spawn", () => { timer = setTimeout(() => finish(), 750); });
        child.once("exit", code => finish(code ? new Error(`browser exited with code ${code}`) : undefined));
    });
}
