# Thoughts

## Overview

Capture ideas in a canvas inside the GitHub Copilot app. Expand long thoughts, edit them, copy the full text, mark them done, or delete them.

![Thoughts in the GitHub Copilot app](screenshot.png)

## Use in the GitHub Copilot app

In the GitHub Copilot app, ask your agent to install [Thoughts](https://github.com/likamrat/ghcp-canvas-apps/tree/main/apps/thoughts) as a personal canvas, then open it. Approve the installation when prompted.

Choose **Add thought** or press **Ctrl/Cmd + Enter** to save an idea. You can also tell your agent what to save.

The bin icon asks for confirmation before permanently deleting a thought.

Thoughts runs locally in the GitHub Copilot app.

## Data

Thoughts are saved locally in SQLite and shared across chats. They stay on your computer when you close the canvas or restart the app.

## Develop

Use the GitHub Copilot app with canvas extension support and Node 24 or later. No build step or package installation is needed.

Run tests from this app's folder:

```sh
node --test store.test.mjs
```

Reload extensions after editing an installed copy.

Icons use [Phosphor Icons](https://github.com/phosphor-icons/core) under MIT ([license](PHOSPHOR-LICENSE.txt)).

## Publish

Keep the source, assets, and this README in `apps/thoughts/`. Push changes to `main`, then update the installed extension in the GitHub Copilot app.

Keep saved thoughts, databases, and logs out of the repository.
