<p align="center">
  <img src="logo.svg" alt="Context Monitor logo" width="440">
</p>

With several Copilot sessions running, it's hard to tell which ones are nearing their context limit. Context Monitor shows where each session stands, so you can decide where to keep working and where to start fresh.

<img src="screenshot.png" alt="Context Monitor with example sessions, a context heat map, collapsed filters, and pagination" width="640">

## Use in the GitHub Copilot app

Context Monitor runs as a personal canvas extension in the GitHub Copilot app. Paste this into a chat:

```text
Install or update Context Monitor as a personal canvas extension from:
https://github.com/likamrat/ghcp-canvas-apps/tree/main/apps/context-monitor

Use persistent personal (user) scope so it is available across projects and chats.
Reuse an existing installation and preserve saved data and settings.
Reload extensions in the GitHub Copilot app, verify the personal canvas registration, and confirm Context Monitor
appears in Canvas apps as "Canvas · Personal" with "New session".
If you cannot inspect that list, say so. Then open Context Monitor.
```

Filter by model, pinned sessions, or context usage. Arrows beside parent names expand one level at a time. Search reveals matching branches; context-usage sorting reveals nested sessions for comparison.

**Filters and refresh** starts collapsed. Expand it to adjust filters, refresh intervals, or usage settings.

Model and Context usage accept multiple selections. Selections within a filter are combined; different filters narrow the results together. Clear a selection to include all.

Choose an auto-refresh interval or refresh manually. **Usage settings** changes the warning levels, initially 65% and 85%. Select a session name for exact token counts.

Use Previous page and Next page to browse 8, 16, or 32 sessions at a time. Paging applies only to the list. The heat map covers all filtered sessions; select a tile to open its list page.

Sessions without context data are hidden by default. Check Include sessions without context data to show them. They have no reported context reading, not 0% usage.

**Open in browser** uses your normal system-default browser, with a local favicon. Closing the canvas leaves that view running; keep the owning Copilot session active. Reloading extensions in the GitHub Copilot app ends the old browser URL. Saved thresholds are shared; filters are independent between views.

Controls, typography, surfaces, and outlined icons match Artifacts. Context colors still represent usage; they do not change with the control styling. The header wordmark follows the app theme, including its inverted circular mark in dark mode.

## Data

Reads the local app database without changing it. Explicit parent links take precedence over legacy creator references; historical session aliases are resolved.

Input/output totals are cumulative. Context shows the current window usage. Warning settings persist across chats. No conversations are read or uploaded. The extension must run on the computer hosting the app's metadata.

## Develop

Use Node 24 or later and the GitHub Copilot app with canvas extension support. No build or package installation is needed.

From this app's folder:

```sh
node --test monitor.test.mjs
```

After updating an installed copy, reload or restart the extension in **Customize** in the GitHub Copilot app. Alternatively, ask Copilot to "reload extensions". Reopen existing browser tabs to load the current code and favicon. Cross-app browser and favicon checks are in `tests/`.

UI typography follows the Copilot app. Bundled asset licenses: [Geist](fonts/LICENSE.txt), [Lucide](LUCIDE-LICENSE.txt), and [Phosphor](icons/LICENSE).
