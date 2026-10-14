# Thoughts

## Overview

A personal space to capture ideas while working with chats and coding agents in GitHub Copilot. Thoughts stays in the canvas panel and shares one saved list across your chats.

| Control | What it does |
| --- | --- |
| Add thought | Save an idea, reminder, or thing to try. |
| Open / Done | Switch between unfinished and completed thoughts. |
| Read more / Show less | Expand or shorten a long thought's two-line preview. |
| Edit (pencil) | Change the text, then Save or Cancel. |
| Copy | Copy the full thought, even when its preview is shortened. |
| Checkbox | Complete a thought or reopen it from Done. |
| Reload | Read the latest saved list, including edits from another chat. |

## Preview

![Thoughts canvas with compact previews and edit/copy controls](screenshot.png)

Synthetic sample content, not a user's saved thoughts. The preview shows the actual canvas controls.

## Use in GitHub Copilot

Requires GitHub Copilot app with CLI canvas extensions and a Node runtime that supports `node:sqlite` (Node 24 recommended).

In a Copilot chat, ask:

> Install this personal canvas extension as `idea-inbox` from https://github.com/likamrat/ghcp-canvas-apps/tree/main/apps/thoughts, then open Thoughts.

Review the installation approval. Use the personal/user scope to make the app available across chats. The installation name `idea-inbox` preserves compatibility with the original Thoughts extension; if you already have it, replace that installation rather than adding a duplicate.

Type a thought and choose **Add thought**, or press **Ctrl/Cmd + Enter**. You can also ask an agent:

> Add "Try keyboard shortcuts for quick capture" to Thoughts.

Closing the canvas or opening it from another chat does not remove your saved list. After updating an installed copy, reload extensions and reopen Thoughts.

This URL installs the extension; it is **not a hosted Canvas URL**. Copilot starts a local server and opens the canvas. Its temporary `127.0.0.1` address is not a shareable link. No GitHub Pages deployment is needed.

## Data

Thoughts stay on your computer in `$COPILOT_HOME/extensions/idea-inbox/artifacts/ideas.sqlite`; `COPILOT_HOME` defaults to `~/.copilot`. Closing the canvas, restarting Copilot, or opening another chat does not remove them.

Only explicitly added thoughts are saved. Conversations are not captured automatically, and nothing is uploaded. Reminders are text in your list, not timed notifications. Concurrent edits are version-checked: if another view changed a thought, reload before trying again rather than overwriting its changes.

The extension directory and canvas ID retain the internal name `idea-inbox` for compatibility. The visible app name is **Thoughts**.

## Develop

From this app's folder:

```sh
node --test store.test.mjs
```

No packages or build step are required. Copilot supplies `@github/copilot-sdk`. After editing an installed copy, reload extensions in that session.

| File | Responsibility |
| --- | --- |
| `extension.mjs` | Canvas lifecycle and agent-facing list/add/update actions. |
| `index.html`, `app.js`, `style.css` | Rendering, capture, filters, editing, copying, and long-text disclosure. |
| `server.mjs` | Local HTTP routes and request checks. |
| `store.mjs` | SQLite persistence and versioned edits. |
| `store.test.mjs` | Persistence, concurrency, and HTTP tests. |
| `icon.svg`, `icon.png` | Editable logo source and launcher asset. |

Edit, copy, and confirmation icons use [Phosphor Icons](https://github.com/phosphor-icons/core) under MIT; the required notice is in `PHOSPHOR-LICENSE.txt`.

## Publish

Keep the app's source, assets, screenshot, and this README together in `apps/thoughts/`. Commit and push changes to this repository's `main` branch; the installation URL above then points to the updated version. Install or update it in Copilot to try the published files.

Keep the preview synthetic. Do not commit saved thoughts, SQLite databases, logs, or session files. Update the [root catalog](../../README.md) if the app's description or installation instructions change.
