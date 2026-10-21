import test from "node:test";
import assert from "node:assert/strict";
import { queryArtifacts, reconcileView, createRequestGate, sessionTree, catalogPresentation, applyPinResult, artifactLabel } from "./model.mjs";

test("pin results update the requested artifact without changing other records", () => {
    const records = [{ id: "selected", pinned: false }, { id: "other", pinned: false }];
    const updated = applyPinResult(records, { id: "other", pinned: true }, "session", "session");
    assert.deepEqual(updated, [{ id: "selected", pinned: false }, { id: "other", pinned: true }]);
    assert.equal(records[1].pinned, false);
});

test("a pin response from a previous session cannot change the current scope", () => {
    const records = [{ id: "shared-artifact", pinned: false }];
    assert.equal(applyPinResult(records, { id: "shared-artifact", pinned: true }, "old", "current"), records);
});

test("artifact labels shorten opaque filenames without inventing document titles", () => {
    const name = `${"ecc27405".repeat(8)}.png`;
    assert.equal(artifactLabel({ name, title: name, kind: "image" }), "Image ecc27405");
    assert.equal(artifactLabel({ name, title: "Capture flow", kind: "image" }), "Capture flow");
    assert.equal(artifactLabel({ name: "implementation.md", kind: "document" }), "implementation.md");
});

test("filters combine across fields and accept multiple kinds and sources", () => {
    const records = [
        { id: "a", name: "plan.md", title: "Plan", kind: "document", source: "published", timestamp: "2026-10-20T12:00:00Z", pinned: true },
        { id: "b", name: "plan.svg", title: "Plan flow", kind: "diagram", source: "session-file", timestamp: "2026-10-20T13:00:00Z", pinned: false },
        { id: "c", name: "photo.png", title: "Photo", kind: "image", source: "uploaded", timestamp: null, pinned: false },
    ];
    assert.deepEqual(queryArtifacts(records, { search: "plan", kinds: ["document", "diagram"], sources: ["published"] }).map(row => row.id), ["a"]);
    assert.deepEqual(queryArtifacts(records, { pinned: true }).map(row => row.id), ["a"]);
    assert.equal(queryArtifacts(records).length, 3);
});

test("date bounds use whole local days, sort missing values last, and reject invalid filters", () => {
    const records = [
        { id: "a", name: "Plan.md", title: "Plan", timestamp: new Date(2026, 9, 20, 23, 59).toISOString(), size: 100 },
        { id: "b", name: "Earlier.md", title: "Earlier", timestamp: new Date(2026, 9, 19, 23, 59).toISOString(), size: 200 },
        { id: "c", name: "Unknown.md", title: "Unknown", timestamp: null, size: null },
    ];
    assert.deepEqual(queryArtifacts(records, { from: "2026-10-20", to: "2026-10-20" }).map(row => row.id), ["a"]);
    assert.deepEqual(queryArtifacts(records, { sort: "size", order: "desc" }).map(row => row.id), ["b", "a", "c"]);
    assert.deepEqual(queryArtifacts(records, { sort: "timestamp", order: "asc" }).map(row => row.id), ["b", "a", "c"]);
    assert.throws(() => queryArtifacts(records, { from: "2026-02-31" }), /date/i);
    assert.throws(() => queryArtifacts(records, { from: "2026-10-21", to: "2026-10-20" }), /date/i);
    assert.throws(() => queryArtifacts(records, { kinds: ["image", "image"] }), /filter/i);
    assert.throws(() => queryArtifacts(records, { sort: "anything" }), /filter/i);
});

test("refresh keeps selection and revision, clamps paging, and rejects stale requests", () => {
    const records = Array.from({ length: 17 }, (_, index) => ({ id: String(index), version: 3 }));
    const view = { selectedId: "12", revision: 1, page: 3, pageSize: 8, layout: "library" };
    assert.deepEqual(reconcileView(view, records), { ...view, pages: 3 });
    assert.deepEqual(reconcileView(view, records.slice(0, 13)), { ...view, page: 2, pages: 2 });
    assert.equal(reconcileView(view, records.slice(0, 4)).selectedId, "0");
    assert.equal(reconcileView(view, records.slice(0, 4)).revision, null);
    assert.equal(reconcileView(view, []).selectedId, null);
    assert.throws(() => reconcileView({ ...view, pageSize: 100 }, records), /page/i);
    const gate = createRequestGate();
    const old = gate.next(), current = gate.next();
    assert.equal(gate.current(old), false);
    assert.equal(gate.current(current), true);
});

test("session search keeps ancestors and collapsed branches expand only when searched", () => {
    const sessions = [
        { id: "root", name: "Build", parentId: null, archived: false },
        { id: "child", name: "Research", parentId: "root", archived: false },
        { id: "old", name: "Archived", parentId: null, archived: true },
    ];
    assert.deepEqual(sessionTree(sessions, {}, new Set(["root"])).map(row => row.id), ["root"]);
    assert.deepEqual(sessionTree(sessions, { search: "Research" }, new Set(["root"])).map(row => [row.id, row.depth]), [["root", 0], ["child", 1]]);
    assert.equal(sessionTree(sessions, { includeArchived: true }).length, 3);
});

test("pending discovery is never presented as empty, and refresh keeps a confirmed snapshot", () => {
    const pending = { phase: "loading", hasSnapshot: false, hasSession: true, total: 0, matching: 0 };
    assert.equal(catalogPresentation(pending), "loading");
    assert.equal(catalogPresentation({ ...pending, hasSession: false }), "loading");
    assert.equal(catalogPresentation({ ...pending, phase: "ready", hasSnapshot: true }), "empty");
    assert.equal(catalogPresentation({ ...pending, phase: "error" }), "error");
    assert.equal(catalogPresentation({ ...pending, phase: "idle", hasSession: false }), "idle");
    assert.equal(catalogPresentation({ ...pending, hasSnapshot: true, total: 2, matching: 2 }), "content");
    assert.equal(catalogPresentation({ ...pending, phase: "error", hasSnapshot: true, total: 2, matching: 2 }), "content");
    assert.equal(catalogPresentation({ ...pending, phase: "ready", hasSnapshot: true, total: 2, matching: 0 }), "filtered");
});
