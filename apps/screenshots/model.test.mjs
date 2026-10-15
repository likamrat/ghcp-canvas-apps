import test from "node:test";
import assert from "node:assert/strict";
import { queryImages, defaultView, clearFilters, sessionTree, createRequestGate, paginateImages, previewScale, nextZoom } from "./model.mjs";

test("combined image filters use local inclusive dates and leave unknown times visible without a range", () => {
    const images = [
        { id: "one", name: "wide.png", source: "uploaded", timestamp: new Date(2026, 9, 14, 23, 59).toISOString(), size: 100 },
        { id: "two", name: "wide.png", source: "generated", timestamp: new Date(2026, 9, 15, 0, 0).toISOString(), size: 50 },
        { id: "unknown", name: "missing.png", source: "unknown", timestamp: null, size: null },
    ];
    assert.deepEqual(queryImages(images, { ...defaultView(), filename: "wide", source: "uploaded", from: "2026-10-14", to: "2026-10-14" }).images.map((item) => item.id), ["one"]);
    assert.equal(queryImages(images, defaultView()).images.length, 3);
    assert.throws(() => queryImages(images, { ...defaultView(), from: "2026-10-15", to: "2026-10-14" }), /date/i);
    assert.throws(() => queryImages(images, { ...defaultView(), from: "2026-02-30" }), /date/i);
});

test("sorting is stable, keeps missing values last in either direction, and groups independently", () => {
    const images = [
        { id: "b", name: "b.png", source: "uploaded", timestamp: null, size: 20 },
        { id: "a", name: "a.png", source: "generated", timestamp: "2026-10-14T20:00:00Z", size: 20 },
        { id: "c", name: "c.png", source: "uploaded", timestamp: "2026-10-13T20:00:00Z", size: null },
    ];
    assert.deepEqual(queryImages(images, { sort: "size", order: "asc", group: "none" }).images.map((row) => row.id), ["a", "b", "c"]);
    assert.deepEqual(queryImages(images, { sort: "size", order: "desc", group: "none" }).images.map((row) => row.id), ["a", "b", "c"]);
    assert.deepEqual(queryImages(images, { sort: "timestamp", order: "asc", group: "none" }).images.map((row) => row.id), ["c", "a", "b"]);
    assert.deepEqual(queryImages(images, { group: "source", order: "asc" }).groups.map((group) => group.label), ["Tool-generated", "Uploaded"]);
    assert.throws(() => queryImages(images, { sort: "path" }), /supported/);
});

test("clear filters preserves display and scope; request generations reject stale completions", () => {
    const view = { ...defaultView(), sessionSearch: "Canvas", filename: "x", source: "uploaded", from: "2026-10-14",
        includeChildren: true, includeArchived: true, sort: "size", order: "asc", group: "source", thumbnail: "large" };
    assert.deepEqual(clearFilters(view), { ...view, sessionSearch: "", filename: "", source: "", from: "", to: "" });
    const gate = createRequestGate();
    const previous = gate.next();
    const current = gate.next();
    assert.equal(gate.current(previous), false);
    assert.equal(gate.current(current), true);
});

test("session navigation preserves matching ancestors, handles collapse, and excludes archived rows", () => {
    const sessions = [
        { id: "parent", name: "Parent", parentId: null, archived: false },
        { id: "child", name: "Gallery", parentId: "parent", archived: false },
        { id: "old", name: "Archived", parentId: null, archived: true },
    ];
    assert.deepEqual(sessionTree(sessions, {}, new Set(["parent"])).map((row) => row.id), ["parent"]);
    assert.deepEqual(sessionTree(sessions, { sessionSearch: "Gallery" }, new Set(["parent"])).map((row) => row.id), ["parent", "child"]);
    assert.equal(sessionTree(sessions, { includeArchived: true }).length, 3);
});

test("pagination defaults to eight, slices across groups, and clamps pages after results shrink", () => {
    const records = Array.from({ length: 35 }, (_, index) => ({
        id: String(index).padStart(2, "0"), name: `${index}.png`, size: index,
        source: index < 5 ? "generated" : "uploaded", timestamp: null,
    }));
    const query = queryImages(records, { group: "source", order: "asc", sort: "size" });
    const first = paginateImages(query);
    assert.equal(first.images.length, 8);
    assert.equal(first.pages, 5);
    assert.deepEqual(first.groups.map((group) => group.images.length), [5, 3]);
    assert.equal(paginateImages(query, 2).images[0].id, "08");
    assert.equal(paginateImages(query, 5).images.length, 3);
    assert.equal(paginateImages(query, 3, 16).images.length, 3);
    assert.equal(paginateImages(query, 2, 32).images.length, 3);
    assert.equal(paginateImages(query, 99).page, 5);
    assert.equal(paginateImages(queryImages([]), 5).page, 1);
    assert.throws(() => paginateImages(query, 1, 10), /page size/i);
});

test("preview zoom starts at the original preview scale and zoom-out never increases a small preview", () => {
    const initial = previewScale(1000, 2000, 500, 500);
    assert.equal(initial, .25);
    assert.equal(nextZoom(null, 1.25, initial), .3125);
    assert.equal(nextZoom(null, .8, initial), .2);
    assert.equal(previewScale(100, 100, 500, 500), 1);
    assert.equal(previewScale(1000, 2000, 0, 0), null);
    const tiny = previewScale(1000, 100000, 500, 500);
    assert.ok(nextZoom(null, .8, tiny) < tiny);
});

test("tool images can be filtered and grouped separately from captured screenshots", () => {
    const records = [
        { id: "viewed", name: "concept.png", source: "tool", timestamp: null, size: 10 },
        { id: "captured", name: "page.png", source: "generated", timestamp: null, size: 20 },
    ];
    const result = queryImages(records, { source: "tool", group: "source" });
    assert.deepEqual(result.images.map((image) => image.id), ["viewed"]);
    assert.equal(result.groups[0].label, "Tool image");
});
