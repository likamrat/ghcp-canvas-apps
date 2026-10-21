import { mkdir, open, unlink, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, dirname, isAbsolute } from "node:path";
import { spawn } from "node:child_process";

const sourceError = (code, message) => Object.assign(new Error(message), { code });

export function revealCommand(path, platform = process.platform, env = process.env) {
    if (!isAbsolute(path) || /^(?:\\\\|\/\/)/.test(path)) throw sourceError("invalid_input", "Only a saved local download can be revealed.");
    if (platform === "win32") return { executable: join(env.WINDIR || "C:\\Windows", "explorer.exe"), args: [`/select,${path}`], selected: true };
    if (platform === "darwin") return { executable: "/usr/bin/open", args: ["-R", path], selected: true };
    return { executable: "/usr/bin/xdg-open", args: [dirname(path)], selected: false };
}

export async function revealDownload(path) {
    let info;
    try { info = await stat(path); }
    catch (error) {
        if (error.code === "ENOENT") throw sourceError("download_missing", "The saved file was moved or deleted. Download it again to reveal it.");
        throw sourceError("folder_open_failed", `Cannot access the saved download: ${error.message}`);
    }
    if (!info.isFile()) throw sourceError("download_missing", "The saved download is no longer a file.");
    const command = revealCommand(path);
    await new Promise((resolve, reject) => {
        const child = spawn(command.executable, command.args, { stdio: "ignore", windowsHide: false, detached: true, shell: false });
        let settled = false, timer;
        const finish = error => {
            if (settled) return;
            settled = true; clearTimeout(timer); child.unref();
            if (error) reject(sourceError("folder_open_failed", `Could not open the folder: ${error.message}`)); else resolve();
        };
        child.once("error", finish);
        child.once("spawn", () => { timer = setTimeout(() => finish(), 500); });
        child.once("exit", code => finish(code ? new Error(`file manager exited with code ${code}`) : undefined));
    });
    return { selected: command.selected };
}

export function downloadName(value, fallback = "screenshot.png") {
    const name = String(value).split(/[\\/]/).at(-1).replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "_").replace(/^[. ]+|[. ]+$/g, "").slice(0, 180);
    return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name || fallback;
}

export function attachment(name) {
    const safe = downloadName(name);
    return `attachment; filename="${safe.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(safe).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

export async function saveFile(bytes, filename, directory = join(homedir(), "Downloads")) {
    filename = downloadName(filename, "artifact");
    try { await mkdir(directory, { recursive: true }); }
    catch (error) { throw sourceError("download_failed", `Cannot access Downloads: ${error.message}`); }
    const extension = extname(filename);
    const stem = filename.slice(0, filename.length - extension.length);
    for (let suffix = 0; suffix < 1000; suffix++) {
        const name = suffix ? `${stem} (${suffix})${extension}` : filename;
        const path = join(directory, name);
        let file;
        try { file = await open(path, "wx", 0o600); }
        catch (error) {
            if (error.code === "EEXIST") continue;
            throw sourceError("download_failed", `Cannot create a file in Downloads: ${error.message}`);
        }
        try {
            await file.writeFile(bytes);
            await file.sync();
            await file.close();
            return { path, name, bytes: bytes.length };
        } catch (error) {
            await file.close();
            try { await unlink(path); }
            catch (cleanupError) {
                throw sourceError("download_failed", `Download failed (${error.message}); partial file could not be removed: ${path} (${cleanupError.message}).`);
            }
            throw sourceError("download_failed", `Download could not be saved: ${error.message}`);
        }
    }
    throw sourceError("download_failed", "Too many files with this name already exist in Downloads. Rename or move earlier downloads.");
}
