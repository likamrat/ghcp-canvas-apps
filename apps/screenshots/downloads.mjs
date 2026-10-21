import { crc32 } from "node:zlib";
import { sourceError } from "./source.mjs";
import { downloadName, saveFile } from "./download-files.mjs";
export { downloadName, attachment, revealCommand, revealDownload } from "./download-files.mjs";

const MAX_EXPORT = 128 * 1024 * 1024;
async function imageBytes(image) {
    try {
        if (image.data) return image.data;
        if (!Number.isSafeInteger(image.size) || image.size < 1 || image.size > 32 * 1024 * 1024) {
            throw sourceError("image_unavailable", "The image size is unsupported. Refresh and retry.");
        }
        const bytes = Buffer.alloc(image.size);
        let read = 0;
        while (read < bytes.length) {
            const { bytesRead } = await image.file.read(bytes, read, bytes.length - read, read);
            if (!bytesRead) throw sourceError("image_changed", "An image changed during export. Refresh and retry.");
            read += bytesRead;
        }
        return bytes;
    } finally { await image.file?.close(); }
}

export async function saveImages(catalog, input, directory) {
    if (!input || typeof input !== "object" || Object.keys(input).some((key) => !["ids", "archive"].includes(key)) ||
        typeof input.archive !== "boolean" || !Array.isArray(input.ids) || !input.ids.length ||
        input.ids.some((id) => typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) ||
        (!input.archive && input.ids.length !== 1)) {
        throw sourceError("invalid_input", "Choose one image or a ZIP archive of indexed images.");
    }
    const filename = input.archive ? "screenshots.zip" : downloadName(catalog.metadata(input.ids[0]).name);
    const bytes = input.archive ? await downloadArchive(catalog, input.ids) : await imageBytes(await catalog.openImage(input.ids[0]));
    return { ...await saveFile(bytes, filename, directory), count: input.ids.length, archive: input.archive };
}

export async function downloadArchive(catalog, ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 10000 ||
        ids.some((id) => typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) || new Set(ids).size !== ids.length) {
        throw sourceError("invalid_input", "Choose between 1 and 10,000 unique indexed images.");
    }
    const records = ids.map((id) => catalog.metadata(id));
    if (records.some((image) => image.availability !== "available")) {
        throw sourceError("image_unavailable", "An image is unavailable. Refresh the gallery before downloading.");
    }
    if (records.some((image) => !Number.isSafeInteger(image.size) || image.size < 1 || image.size > 32 * 1024 * 1024)) {
        throw sourceError("image_unavailable", "Image sizes are invalid or have changed. Refresh before downloading.");
    }
    if (records.reduce((total, image) => total + image.size, 0) > MAX_EXPORT) {
        throw sourceError("export_too_large", "Download all is limited to 128 MiB. Narrow the filters or download images individually.");
    }
    const chunks = [], central = [];
    let offset = 0;
    for (const [index, record] of records.entries()) {
        const image = await catalog.openImage(record.id);
        const bytes = await imageBytes(image);
        const name = Buffer.from(`${String(index + 1).padStart(4, "0")}-${downloadName(record.name)}`, "utf8");
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x800, 6);
        local.writeUInt16LE(0x21, 12);
        const checksum = crc32(bytes);
        local.writeUInt32LE(checksum, 14);
        local.writeUInt32LE(bytes.length, 18);
        local.writeUInt32LE(bytes.length, 22);
        local.writeUInt16LE(name.length, 26);
        const entry = Buffer.alloc(46);
        entry.writeUInt32LE(0x02014b50, 0);
        entry.writeUInt16LE(20, 4);
        entry.writeUInt16LE(20, 6);
        entry.writeUInt16LE(0x800, 8);
        entry.writeUInt16LE(0x21, 14);
        entry.writeUInt32LE(checksum, 16);
        entry.writeUInt32LE(bytes.length, 20);
        entry.writeUInt32LE(bytes.length, 24);
        entry.writeUInt16LE(name.length, 28);
        entry.writeUInt32LE(offset, 42);
        chunks.push(local, name, bytes);
        central.push(entry, name);
        offset += local.length + name.length + bytes.length;
        if (offset > MAX_EXPORT) throw sourceError("export_too_large", "ZIP exceeds the 128 MiB download limit. Narrow the filters.");
    }
    const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(records.length, 8);
    end.writeUInt16LE(records.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    if (offset + centralSize + end.length > MAX_EXPORT) throw sourceError("export_too_large", "ZIP exceeds the 128 MiB download limit. Narrow the filters.");
    return Buffer.concat([...chunks, ...central, end]);
}
