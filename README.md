# GitHub Copilot Canvas Apps

## Overview

Small, local canvas apps for working alongside chats and coding agents in GitHub Copilot. Each opens in the app's canvas panel rather than a separate hosted website.

| App | What it does |
| --- | --- |
| [Thoughts](apps/thoughts/README.md) | Capture, revisit, edit, copy, and complete ideas across chats. |
| [Context Monitor](apps/context-monitor/README.md) | Monitor nested sessions, sort by context usage, and configure refresh intervals and usage warnings. |

## Preview

### Thoughts

![Thoughts: capture, edit, copy, and complete ideas](apps/thoughts/screenshot.png)

### Context Monitor

![Context Monitor: nested sessions, usage sorting, and configurable warnings](apps/context-monitor/screenshot.png)

Both previews use synthetic sample content. The Context Monitor image is a high-resolution rendering of the actual canvas, not a live account snapshot.

## Use in GitHub Copilot

Requires GitHub Copilot app with CLI canvas extensions and a Node runtime supporting `node:sqlite` (Node 24 recommended). Follow the installation prompt in the app's README:

| App | Installation name | Instructions |
| --- | --- | --- |
| Thoughts | `idea-inbox` | [Install and open Thoughts](apps/thoughts/README.md#use-in-github-copilot) |
| Context Monitor | `context-monitor` | [Install and open Context Monitor](apps/context-monitor/README.md#use-in-github-copilot) |

Review the installation approval and choose personal/user scope to use an app across chats. Installation URLs point to extension source on `main`, not hosted canvases. Copilot starts a temporary loopback server locally; no GitHub Pages deployment is needed.

Context Monitor additionally needs access to the desktop app's local metadata database. It cannot enumerate that database from an unrelated remote or cloud machine.

## Data

Thoughts saves only the ideas you explicitly add. Context Monitor reads the app's session metadata without modifying it and saves only your usage-warning preferences in its own database.

Both apps keep their data on your computer under `$COPILOT_HOME`, which defaults to `~/.copilot`. See each app's **Data** section for exact locations, persistence, and limitations. Do not commit personal data, databases, logs, or real-session screenshots.

## Develop

Each app lives in `apps/<app-name>/`, with its source, assets, screenshot, and exactly one `README.md`. All READMEs use the same top-level sections: **Overview**, **Preview**, **Use in GitHub Copilot**, **Data**, **Develop**, and **Publish**. Keep app-specific instructions in that app's README; no separate setup guides or documentation folders.

Run both apps' tests from the repository root:

```sh
node --test apps/thoughts/store.test.mjs apps/context-monitor/monitor.test.mjs
```

No dependency installation or build step is required. Copilot supplies `@github/copilot-sdk`. Reload extensions after changing an installed copy. The repository's `.github/extensions/context-monitor/extension.mjs` entry loads Context Monitor from its app folder during development.

## Publish

Commit each app's source, required license notices, preview, and README together, then merge to `main` to update the documented installation URLs. Install or update the personal extension in Copilot to use the published version.

When adding an app, follow the same six README sections and add it to this catalog. Use synthetic content in previews and include any bundled asset licenses.
