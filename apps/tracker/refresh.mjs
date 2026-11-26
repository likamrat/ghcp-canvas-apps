export function createRefreshCycle({ refresh, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let interval = 0, busy = false, hidden = false, stopped = false, timer;
    function schedule() {
        clearTimer(timer);
        timer = undefined;
        if (!interval || busy || hidden || stopped) return;
        timer = setTimer(() => {
            timer = undefined;
            if (!busy && !hidden && !stopped) refresh();
        }, interval);
    }
    return {
        setInterval(value) {
            if (![0, 5000, 10000, 30000, 60000, 300000].includes(value)) throw new Error("Choose a supported refresh interval.");
            interval = value;
            schedule();
        },
        setBusy(value) {
            if (busy === value) return;
            busy = value;
            schedule();
        },
        setHidden(value) {
            const returning = hidden && !value;
            hidden = value;
            schedule();
            if (returning && interval && !busy && !stopped) {
                clearTimer(timer);
                timer = undefined;
                refresh();
            }
        },
        stop() { stopped = true; schedule(); },
        resume() { stopped = false; schedule(); },
    };
}
