<p align="center">
  <img src="logo.svg" alt="Thoughts logo" width="440">
</p>

Ideas often show up while you're in the middle of something else. Thoughts keeps them in one place across your Copilot chats, so you can stay with the task at hand and come back to them later.

<img src="screenshot.png" alt="Thoughts showing sample ideas, copy and edit actions, and completion controls" width="400">

## Use in the GitHub Copilot app

Thoughts runs as a personal canvas extension in the GitHub Copilot app. Paste this into a chat:

```text
Install or update Thoughts as a personal canvas extension from:
https://github.com/likamrat/ghcp-canvas-apps/tree/main/apps/thoughts

Use persistent personal (user) scope so it is available across projects and chats.
Reuse an existing installation and preserve saved thoughts and settings.
Reload extensions in the GitHub Copilot app, verify the personal canvas registration, and confirm Thoughts
appears in Canvas apps as "Canvas · Personal" with "New session".
If you cannot inspect that list, say so. Then open Thoughts.
```

Choose **Add thought** or press **Ctrl/Cmd + Enter** to save an idea. You can also ask your agent to save one. The bin icon asks for confirmation before permanently deleting a thought.

**Open in browser** uses your normal system-default browser, with the Thoughts favicon. Both views share saved thoughts; unsaved drafts are independent. Closing the canvas leaves the browser view running, but ending its Copilot session or reloading extensions in the GitHub Copilot app stops the old URL.

Thoughts uses the same controls, outlined action icons, typography, and light/dark surfaces as Artifacts. Edit, copy, and delete stay beside each thought. The header wordmark follows the app theme; its circular mark inverts in dark mode.

## Data

Thoughts are saved locally in SQLite and shared across chats. They stay on your computer when the canvas or app closes.

## Develop

Use Node 24 or later and the GitHub Copilot app with canvas extension support. No build or package installation is needed.

From this app's folder:

```sh
node --test store.test.mjs
```

After updating an installed copy, reload or restart the extension in **Customize** in the GitHub Copilot app. Alternatively, ask Copilot to "reload extensions". Reopen existing browser tabs to load the current code and favicon. Cross-app browser and favicon checks are in `tests/`.

Bundled icon licenses: [Lucide](LUCIDE-LICENSE.txt) and [Phosphor](PHOSPHOR-LICENSE.txt).
