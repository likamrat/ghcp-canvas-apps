# Thoughts

## Overview

Capture ideas while chatting with coding agents. Expand long thoughts, edit them, copy the full text, or mark them done.

## Use in GitHub Copilot

Ask your Copilot agent to install [Thoughts](https://github.com/likamrat/ghcp-canvas-apps/tree/main/apps/thoughts) as a personal canvas, then open it. Approve the installation when prompted.

Choose **Add thought** or press **Ctrl/Cmd + Enter** to save an idea. You can also tell your agent what to save.

Thoughts runs locally as a Copilot extension.

## Data

Thoughts are saved locally in SQLite and shared across chats. They stay on your computer when you close the canvas or restart Copilot.

## Develop

Use a Copilot runtime with canvas extension support and Node 24 or later. No build step or package installation is needed.

Run tests from this app's folder:

```sh
node --test store.test.mjs
```

Reload extensions after editing an installed copy.

Icons use [Phosphor Icons](https://github.com/phosphor-icons/core) under MIT ([license](PHOSPHOR-LICENSE.txt)).

## Publish

Keep the source, assets, and this README in `apps/thoughts/`. Push changes to `main`, then update the installed extension in Copilot.

Keep saved thoughts, databases, and logs out of the repository.
