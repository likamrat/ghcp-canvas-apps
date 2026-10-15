# Canvas apps for the GitHub Copilot app

Small productivity apps for developers working in the GitHub Copilot app. Each opens in a canvas panel alongside your chats.

| App | What it does |
| --- | --- |
| [Thoughts](apps/thoughts/README.md) | Save and revisit ideas across chats. |
| [Context Monitor](apps/context-monitor/README.md) | View nested sessions, filter by pins or model, and compare context usage. |
| [Screenshots](apps/screenshots/README.md) | Browse session uploads and tool screenshots with filters, sorting, and full-size previews. |

## Open in a browser

Every app includes **Open in browser** in its header. It opens a dedicated app-style Edge, Chrome, or Chromium window when a supported installation is available. Otherwise it explicitly falls back to the system browser, which may use a tab. The canvas stays open; closing it does not stop a view that was popped out.

Browser views use the same local app server and saved data. Keep the owning Copilot session running. Ending that session, exiting Copilot, or reloading extensions stops the old browser URL; reopen the canvas and use the button again. Filters and unsaved drafts are independent between views. Screenshots carries the selected session into the browser view.

## Default for new apps

Include a compact **Open in browser** header button and visible launch/error status in every new canvas app. Use a validated, authenticated same-origin POST to launch only the app's own loopback URL; never accept arbitrary URLs or commands from the page. Prefer a dedicated app-style window and report default-browser fallback honestly.

Keep servers alive after canvas close only when a browser view has explicitly been opened, and release them when the extension exits. Ordinary canvas-only instances still close their servers normally. No persistent daemon or extension-global setting is required.

Each app is independently installable, so `browser.mjs` and `browser.js` are bundled inside each app folder rather than imported from a sibling. Keep those copies identical; `tests/browser.test.mjs` checks the shared contract across all three apps. Run `node --test tests/browser.test.mjs` from the repository root.
