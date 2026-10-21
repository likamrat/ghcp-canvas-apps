# Canvas apps for the GitHub Copilot app

Personal canvas extensions for the GitHub Copilot app. Each opens in a panel alongside your chats.

| App | What it does |
| --- | --- |
| [Thoughts](apps/thoughts/README.md) | Keep ideas for later without losing focus on your current task. |
| [Context Monitor](apps/context-monitor/README.md) | See which sessions have room to continue and which are nearing their context limit. |
| [Screenshots](apps/screenshots/README.md) | Find the screenshot you need without digging through old chats. |
| [Artifacts](apps/artifacts/README.md) | Browse and pin session artifacts, preview files, and revisit captured note versions. |

In Artifacts, Screenshots, and Context Monitor, **Filters and refresh** starts collapsed. Expand it to adjust the controls. Filter headings and refresh buttons use matching icons across the apps.

All four apps use the same theme-aware typography, surfaces, outlined icons, focus states, and control sizes: 36px on desktop and 44px in narrow views. Each keeps its own layout and workflow.

A short line beneath each wordmark describes the problem the app helps with. These lines share an italic serif style; controls and data keep the app's UI font.

For contributors: `branding.css` and `ui-icons.svg` are identical in every app folder so each extension remains independently installable. Update the copies together; `tests/branding.test.mjs` checks parity and asset delivery. Use `control-button` for boxed actions and add `icon-button` for icon-only actions with an accessible label. Content rows, tree expanders, and heat-map cells keep their own sizing.

Filter headers use the same text metrics and collapsed height as action controls. Native dropdowns stay native, with a `select-field` wrapper for the shared arrow. Filter grids adapt to the available width and text size instead of using fixed field widths; `control-grid-three` keeps three- and six-field groups balanced. Context Monitor's bars, heat map, and usage colors remain app-specific.

Run `node --test` for the automated regressions, including saved-file and ZIP-content checks. For rendered layout checks, open each local app fixture in Playwright and run `tests/canvas-ui.browser.mjs` with the run-code tool. It checks 11 widths, both themes, and 14px/16px host text, including the longest dropdown options.
