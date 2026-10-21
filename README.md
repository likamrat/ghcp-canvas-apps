# Canvas apps for the GitHub Copilot app

Personal canvas extensions for the GitHub Copilot app. Each opens in a panel alongside your chats.

| App | What it does |
| --- | --- |
| [Artifacts](apps/artifacts/README.md) | Find and keep the files your chats produce. |
| [Thoughts](apps/thoughts/README.md) | Keep ideas for later without losing focus on your current task. |
| [Context Monitor](apps/context-monitor/README.md) | See which sessions have room to continue and which are nearing their context limit. |
| [Screenshots](apps/screenshots/README.md) | Find the screenshot you need without digging through old chats. |

Open an app's README for screenshots and installation instructions. Your data stays on your computer.

## Development

Node 24+. Run `node --test` from the repository root.

Each app is independently installable. Keep `branding.css` and `ui-icons.svg` identical across app folders; the tests check this. For rendered control checks, run `tests/canvas-ui.browser.mjs` through Playwright's run-code tool on each local app fixture.
