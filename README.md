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

For contributors: `branding.css` and `ui-icons.svg` are identical in every app folder so each extension remains independently installable. Update the copies together; `tests/branding.test.mjs` checks parity and asset delivery. Use `control-button` for boxed actions and add `icon-button` for icon-only actions with an accessible label. Content rows, tree expanders, and heat-map cells keep their own sizing.
