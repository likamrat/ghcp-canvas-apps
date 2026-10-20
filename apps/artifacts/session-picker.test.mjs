import test from "node:test";
import assert from "node:assert/strict";
import { pickerOptions, movePickerFocus, pickerPlacement } from "./session-picker-model.mjs";

test("session search matches names, projects, and parent context without archived rows", () => {
    const sessions = [
        { id: "root", name: "Release planning", project: "Canvas apps", parentId: null },
        { id: "child", name: "Review notes", project: "Canvas apps", parentId: "root" },
        { id: "old", name: "Old release", archived: true },
    ];
    assert.deepEqual(pickerOptions(sessions, "canvas").map(row => row.id), ["root", "child"]);
    assert.deepEqual(pickerOptions(sessions, "notes").map(row => row.id), ["child"]);
    assert.match(pickerOptions(sessions, "notes")[0].description, /Release planning/);
    assert.equal(pickerOptions(sessions, "not present").length, 0);
    assert.equal(pickerOptions(sessions, "", true).length, 3);
});

test("keyboard navigation stays in the result list and supports page and end jumps", () => {
    const options = Array.from({ length: 25 }, (_, index) => ({ id: String(index) }));
    assert.equal(movePickerFocus(options, null, "ArrowDown"), "0");
    assert.equal(movePickerFocus(options, null, "ArrowUp"), "24");
    assert.equal(movePickerFocus(options, "0", "ArrowUp"), "0");
    assert.equal(movePickerFocus(options, "24", "ArrowDown"), "24");
    assert.equal(movePickerFocus(options, "12", "PageDown", 5), "17");
    assert.equal(movePickerFocus(options, "12", "PageUp", 5), "7");
    assert.equal(movePickerFocus(options, "12", "Home"), "0");
    assert.equal(movePickerFocus(options, "12", "End"), "24");
    assert.equal(movePickerFocus([], null, "ArrowDown"), null);
});

test("the picker stays inside the viewport and opens above a low trigger", () => {
    const viewport = { width: 600, height: 800 };
    const below = pickerPlacement({ left: 20, top: 100, bottom: 136, width: 560 }, viewport, 1000);
    assert.equal(below.top, 142);
    assert.equal(below.maxHeight, 480);
    const above = pickerPlacement({ left: 20, top: 720, bottom: 756, width: 560 }, viewport, 1000);
    assert.equal(above.top, 234);
    assert.ok(above.top + above.maxHeight < 720);
    const short = pickerPlacement({ left: 20, top: 720, bottom: 756, width: 560 }, viewport, 160);
    assert.equal(short.top, 554);
    const small = pickerPlacement({ left: 10, top: 70, bottom: 104, width: 300 }, { width: 320, height: 180 }, 1000);
    assert.ok(small.left >= 12 && small.left + small.width <= 308);
    assert.ok(small.top >= 12 && small.top + small.maxHeight <= 168);
    const keyboard = pickerPlacement({ left: 16, top: 600, bottom: 644, width: 358 }, { width: 390, height: 300 }, 1000);
    assert.ok(keyboard.top >= 12 && keyboard.top + keyboard.maxHeight <= 288);
});
