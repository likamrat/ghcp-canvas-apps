# Thoughts

Capture ideas in a canvas inside the GitHub Copilot app. Expand long thoughts, edit them, copy the full text, mark them done, or delete them.

<img src="screenshot.png" alt="Thoughts in the GitHub Copilot app" width="400">

## Use in the GitHub Copilot app

Paste this into a chat in the GitHub Copilot app:

```text
Install or update Thoughts as a personal canvas extension from:
https://github.com/likamrat/ghcp-canvas-apps/tree/main/apps/thoughts

Use persistent personal (user) scope, not project or session scope, so it is available across projects and chats after this conversation ends.
Keep the app's existing SDK canvas declaration: display name "Thoughts", canvas ID "idea-inbox".
Reuse an existing personal installation rather than creating duplicates, and preserve saved thoughts and settings.

Reload extensions and verify that the personal provider is loaded and the canvas is registered.
Confirm that GitHub Copilot's Canvas apps list contains "Thoughts" as "Canvas · Personal", with a "New session" action.
If you cannot inspect that UI, clearly state what registration you verified and that the menu still needs a manual check.
Do not substitute a temporary preview, browser tab, skill, or project-only extension for installation.

Then open Thoughts.
```

After personal installation, open **Canvas apps**, find **Thoughts** labeled **Canvas · Personal**, and choose **New session**. It should remain available across projects and chats, not only in the installing conversation. Its internal canvas ID is `idea-inbox`, but its name in the app is **Thoughts**.

Choose **Add thought** or press **Ctrl/Cmd + Enter** to save an idea. You can also tell your agent what to save.

Choose **Open in browser** in the header to use your normal system-default browser through the OS URL handler. No browser executable, app-mode window, or isolated profile is forced; tab/window behavior follows your browser settings. Both views use the same saved thoughts; unsaved drafts are independent. Closing the canvas does not stop an explicitly opened browser view, but ending the owning Copilot session or reloading extensions does. Reopen through the canvas after a reload.

The bin icon asks for confirmation before permanently deleting a thought.

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
