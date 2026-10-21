// Run with Playwright's run-code tool on each local app fixture tab.
async (page) => {
    const name = await page.title();
    if (!["Artifacts", "Screenshots", "Context Monitor", "Thoughts"].includes(name) || new URL(page.url()).hostname !== "127.0.0.1") {
        throw Error("Open a local canvas app fixture before running the audit.");
    }
    if (await page.locator("dialog[open]").count()) throw Error(`${name}: close dialogs before the audit.`);
    const failures = [], measurements = [];
    const near = (a, b) => Math.abs(a - b) <= 1;
    for (const fontSize of [14, 16]) {
        const typography = await page.addStyleTag({ content: `:root, body { --text-body-medium: ${fontSize}px; --leading-body-medium: ${fontSize === 16 ? 24 : 20}px; }` });
        try {
            for (const width of [1440, 1180, 1024, 1001, 900, 768, 681, 671, 480, 390, 320]) {
                await page.setViewportSize({ width, height: 1000 });
                for (const theme of ["light", "dark"]) {
                    await page.emulateMedia({ colorScheme: theme });
                    const panel = page.locator("details.control-panel");
                    if (await panel.count()) await panel.evaluate(element => { element.open = false; });
                    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                    const collapsed = await page.evaluate(() => {
                        const metric = element => {
                            if (!element) return null;
                            const bounds = element.getBoundingClientRect(), style = getComputedStyle(element);
                            return { height: bounds.height, left: bounds.left, right: bounds.right, width: bounds.width,
                                font: style.fontFamily, size: style.fontSize, weight: style.fontWeight, line: style.lineHeight };
                        };
                        return {
                            action: metric(document.querySelector("#open-browser")),
                            panel: metric(document.querySelector(".control-panel")),
                            heading: metric(document.querySelector(".control-panel > summary")),
                            scope: metric(document.querySelector(".session-context #session-picker")),
                            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
                        };
                    });
                    const expectedHeight = width <= 680 ? 44 : 36;
                    const label = `${name} ${width}px ${theme} text=${fontSize}px`;
                    if (collapsed.overflow) failures.push(`${label}: horizontal page overflow`);
                    if (!near(collapsed.action.height, expectedHeight)) failures.push(`${label}: action height ${collapsed.action.height}`);
                    if (collapsed.panel) {
                        if (!near(collapsed.panel.height, collapsed.action.height))
                            failures.push(`${label}: collapsed filter ${collapsed.panel.height}px vs action ${collapsed.action.height}px`);
                        for (const key of ["font", "size", "weight", "line"]) {
                            if (collapsed.heading[key] !== collapsed.action[key])
                                failures.push(`${label}: filter heading ${key}=${collapsed.heading[key]} vs action ${collapsed.action[key]}`);
                        }
                        if (collapsed.scope && (!near(collapsed.scope.left, collapsed.panel.left) || !near(collapsed.scope.right, collapsed.panel.right)))
                            failures.push(`${label}: session field width ${collapsed.scope.width}px vs filter panel ${collapsed.panel.width}px`);
                        await panel.evaluate(element => { element.open = true; });
                    }
                    const fields = await page.evaluate(() => [...document.querySelectorAll(
                        '.control-panel input:not([type="checkbox"]), .control-panel select:not([multiple]), .multi-select > summary, .control-button'
                    )].filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden")
                        .map(element => {
                            const style = getComputedStyle(element);
                            const nativeSelect = element.matches("select:not([multiple])");
                            const context = document.createElement("canvas").getContext("2d");
                            context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                            const longest = nativeSelect ? Math.max(...[...element.options].map(option => context.measureText(option.text).width)) : null;
                            return { name: element.id || element.getAttribute("aria-label") || element.textContent.trim(),
                                height: element.getBoundingClientRect().height, font: style.fontFamily, size: style.fontSize, line: style.lineHeight,
                                longest, room: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
                                hasArrow: !nativeSelect || (element.parentElement.classList.contains("select-field") && getComputedStyle(element.parentElement, "::after").content !== "none") };
                        }));
                    for (const field of fields) {
                        if (!near(field.height, expectedHeight)) failures.push(`${label}: ${field.name} height=${field.height}`);
                        for (const key of ["font", "size", "line"]) {
                            if (field[key] !== collapsed.action[key]) failures.push(`${label}: ${field.name} ${key}=${field[key]} vs action ${collapsed.action[key]}`);
                        }
                        if (field.longest !== null && field.longest > field.room + 1) failures.push(`${label}: ${field.name} clips an option (${field.longest}px in ${field.room}px)`);
                        if (!field.hasArrow) failures.push(`${label}: ${field.name} has no dropdown affordance`);
                    }
                    if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth))
                        failures.push(`${label}: expanded filter overflow`);
                    measurements.push({ app: name, width, theme, fontSize, ...collapsed });
                }
            }
        } finally {
            await typography.evaluate(element => element.remove());
        }
    }
    if (failures.length) throw Error(`${failures.length} control inconsistencies:\n${failures.join("\n")}`);
    return { variants: measurements.length, failures: [], deviceScale: await page.evaluate(() => devicePixelRatio),
        samples: measurements.filter(item => item.width === 671 && item.theme === "light" && item.fontSize === 14) };
}
