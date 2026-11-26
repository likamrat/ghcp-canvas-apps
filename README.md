# Canvas apps for the GitHub Copilot app

These Canvas apps open beside your chats in the GitHub Copilot app. Each installs separately and keeps its data on your computer.

| App | What it does |
| --- | --- |
| [Artifacts](apps/artifacts/README.md) | Find and keep the files your chats produce. |
| [Thoughts](apps/thoughts/README.md) | Keep ideas for later without losing focus on your current task. |
| [Context Monitor](apps/context-monitor/README.md) | See which sessions have room to continue and which are nearing their context limit. |
| [Screenshots](apps/screenshots/README.md) | Find the screenshot you need without digging through old chats. |
| [Tracker](apps/tracker/README.md) | Track work and subtasks by status. Update the list yourself or ask Copilot. |

Each app's README has screenshots, a copy-ready install prompt, and instructions for using it.

## Development

Use Node 24 or later. Run `node --test` from the repository root.

Keep `branding.css` and `ui-icons.svg` identical across app folders. The tests check both files. To check controls in the browser for Artifacts, Context Monitor, Screenshots, or Thoughts, run `tests/canvas-ui.browser.mjs` through Playwright's run-code tool on the local app fixture.
