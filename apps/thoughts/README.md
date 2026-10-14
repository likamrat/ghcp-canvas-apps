# Thoughts

## Overview

A personal space to capture ideas while working with chats and coding agents. Long thoughts show a two-line preview with **Read more**. Use the pencil to edit, the copy icon to copy the full text, and the checkbox to complete or reopen a thought.

## Preview

![Thoughts canvas with compact previews and edit/copy controls](screenshot.png)

Sample content, not a user's saved thoughts.

## Use in GitHub Copilot

Requires GitHub Copilot app with CLI canvas extensions and a Node runtime that supports `node:sqlite` (Node 24 recommended).

In a Copilot chat, ask:

> Install this personal canvas extension as `idea-inbox` from https://github.com/likamrat/ghcp-canvas-apps/tree/main/apps/thoughts, then open Thoughts.

Review the installation approval. Use the personal/user scope to make the app available across chats. The installation name `idea-inbox` preserves compatibility with the original Thoughts extension; if you already have it, replace that installation rather than adding a duplicate.

Type a thought and choose **Add thought**, or press **Ctrl/Cmd + Enter**. You can also ask an agent: "Add 'Try keyboard shortcuts for quick capture' to Thoughts."

This URL installs the extension; it is **not a hosted Canvas URL**. Copilot starts a local server and opens the canvas. Its temporary `127.0.0.1` address is not a shareable link. No GitHub Pages deployment is needed.

## Data

Thoughts stay on your computer in `$COPILOT_HOME/extensions/idea-inbox/artifacts/ideas.sqlite`; `COPILOT_HOME` defaults to `~/.copilot`. Closing the canvas, restarting Copilot, or opening another chat does not remove them. Nothing is uploaded, conversations are not captured automatically, and reminders do not send timed notifications.

The extension directory and canvas ID retain the internal name `idea-inbox` for compatibility. The visible app name is **Thoughts**.

## Develop

From this app's folder:

```sh
node --test store.test.mjs
```

No packages or build step are required. Copilot supplies `@github/copilot-sdk`. After editing an installed copy, reload extensions in that session.

The entry point is `extension.mjs`; rendering lives in `index.html`, `app.js`, and `style.css`; local HTTP and storage live in `server.mjs` and `store.mjs`. `icon.svg` is the editable logo source and `icon.png` is its launcher asset.

Edit, copy, and confirmation icons use [Phosphor Icons](https://github.com/phosphor-icons/core) under MIT; the required notice is in `PHOSPHOR-LICENSE.txt`.

## Publish

Keep the app's source, assets, screenshot, and this README together in `apps/thoughts/`. Commit and push changes to this repository's `main` branch; the installation URL above then points to the updated version. Install or update it in Copilot to try the published files.

Do not commit saved thoughts, SQLite databases, logs, or session files. To publish another app, add `apps/<app-name>/` and follow this README's section structure, then add one row to the root catalog.
