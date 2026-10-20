import test from "node:test";
import assert from "node:assert/strict";
import { createRefreshCycle } from "./refresh.mjs";

function clock() {
    let now = 0, id = 0;
    const timers = new Map();
    return {
        setTimer(callback, delay) { timers.set(++id, { callback, due: now + delay }); return id; },
        clearTimer(id) { timers.delete(id); },
        tick(milliseconds) {
            now += milliseconds;
            for (const [id, timer] of [...timers]) {
                if (timer.due <= now) { timers.delete(id); timer.callback(); }
            }
        },
        count: () => timers.size,
    };
}

test("auto-refresh defaults off and honors every supported interval without overlapping a read", () => {
    for (const interval of [5000, 10000, 30000, 60000, 300000]) {
        const timers = clock();
        let reads = 0;
        const cycle = createRefreshCycle({ ...timers, refresh: () => { reads++; cycle.setBusy(true); } });
        timers.tick(interval);
        assert.equal(reads, 0);
        cycle.setInterval(interval);
        timers.tick(interval - 1);
        assert.equal(reads, 0);
        timers.tick(1);
        assert.equal(reads, 1);
        timers.tick(interval * 2);
        assert.equal(reads, 1);
        cycle.setBusy(false);
        timers.tick(interval);
        assert.equal(reads, 2);
        cycle.setInterval(0);
        cycle.setBusy(false);
        assert.equal(timers.count(), 0);
    }
});

test("changing intervals during a read uses only the latest value; hiding and closing cancel timers", () => {
    const timers = clock();
    let reads = 0;
    const cycle = createRefreshCycle({ ...timers, refresh: () => { reads++; cycle.setBusy(true); } });
    cycle.setInterval(5000);
    timers.tick(5000);
    cycle.setInterval(10000);
    cycle.setInterval(30000);
    timers.tick(60000);
    assert.equal(reads, 1);
    cycle.setBusy(false);
    timers.tick(29999);
    assert.equal(reads, 1);
    timers.tick(1);
    assert.equal(reads, 2);
    cycle.setBusy(false);
    cycle.setHidden(true);
    assert.equal(timers.count(), 0);
    timers.tick(60000);
    assert.equal(reads, 2);
    cycle.setHidden(false);
    assert.equal(reads, 3);
    cycle.setBusy(false);
    cycle.stop();
    timers.tick(60000);
    assert.equal(reads, 3);
    cycle.resume();
    timers.tick(30000);
    assert.equal(reads, 4);
    cycle.setInterval(0);
    cycle.setBusy(false);
    cycle.setHidden(true);
    cycle.setHidden(false);
    assert.equal(reads, 4);
    assert.throws(() => cycle.setInterval(1000), /supported/);
});
