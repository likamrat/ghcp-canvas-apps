# Context Monitor

See your GitHub Copilot app sessions, models, and context usage in one canvas.

<a href="screenshot-full.png?v=17e33e5bb36b"><img src="screenshot.png?v=c96b0b4a19b6" alt="Context Monitor with sample GPT-6, GPT-6.1, and Claude sessions using different context windows" width="640"></a>

## Use in the GitHub Copilot app

Paste this into a chat in the GitHub Copilot app:

```text
Install or update Context Monitor as a personal canvas extension from:
https://github.com/likamrat/ghcp-canvas-apps/tree/main/apps/context-monitor

Open Context Monitor when installation is complete.
```

Install in personal scope to make Context Monitor available from Canvas apps across chats.

Choose **Open in browser** in the header to use your normal system-default browser through the OS URL handler. No browser executable, app-mode window, or isolated profile is forced; tab/window behavior follows your browser settings. Closing the canvas leaves an explicitly opened browser view running. Keep the owning Copilot session active; session exit or extension reload ends its old browser URL. Saved thresholds are shared, while filters are independent between views.

Filter by model, pinned sessions, or context usage. Use the arrow beside a parent session's name to show its nested sessions. Branches start collapsed at every level, so opening a parent reveals its immediate children rather than all descendants. Indentation, branch connectors, and parent/nested labels show the hierarchy. Search and filters temporarily reveal matching branches; context-usage sorting reveals nested sessions for comparison.

Choose a refresh interval or refresh manually. Open Usage settings to change the warning levels or reset them to 65% and 85%. Select a session name for exact token counts.

## Data

Reads the app's local session database without changing it. Explicit workspace parent links take precedence over legacy creator references, with historical session aliases resolved before rendering the hierarchy. Input totals count tokens read across requests; output totals count tokens generated. Context shows the current window usage.

Warning settings are saved locally across chats. Filters are temporary. No conversations are read or uploaded. The extension must run on the computer hosting the app's metadata.

## Develop

Use the GitHub Copilot app with canvas extension support and Node 24 or later. No build step or package installation is needed.

Run tests from this app's folder:

```sh
node --test monitor.test.mjs
```

Reload extensions after editing an installed copy.

Fonts use [Geist](https://github.com/vercel/geist-font) ([license](fonts/LICENSE.txt)). Icons use [Phosphor Icons](https://github.com/phosphor-icons/core) ([license](icons/LICENSE)).

## Publish

Keep the source, assets, and this README in `apps/context-monitor/`. Push changes to `main`, then update the installed extension in the GitHub Copilot app.

Keep session data, databases, and logs out of the repository.
