<p align="center">
  <img src="logo.svg" alt="Context Monitor logo" width="440">
</p>

With several Copilot sessions running, it's hard to tell which ones are nearing their context limit. Context Monitor shows where each session stands, so you can decide where to keep working and where to start fresh.

<a href="screenshot-full.png"><img src="screenshot.png" alt="Context Monitor with sample parent and nested sessions, model filters, and context usage" width="640"></a>

## Use in the GitHub Copilot app

Paste this into a chat:

```text
Install or update Context Monitor as a personal canvas extension from:
https://github.com/likamrat/ghcp-canvas-apps/tree/main/apps/context-monitor

Use persistent personal (user) scope so it is available across projects and chats.
Reuse an existing installation and preserve saved data and settings.
Reload extensions, verify the personal canvas registration, and confirm Context Monitor
appears in Canvas apps as "Canvas · Personal" with "New session".
If you cannot inspect that list, say so. Then open Context Monitor.
```

Filter by model, pinned sessions, or context usage. Arrows beside parent names expand one level at a time. Search reveals matching branches; context-usage sorting reveals nested sessions for comparison.

Choose an auto-refresh interval or refresh manually. **Usage settings** changes the warning levels, initially 65% and 85%. Select a session name for exact token counts.

**Open in browser** uses your normal system-default browser, with a local favicon. Closing the canvas leaves that view running; keep the owning Copilot session active. Extension reload ends the old browser URL. Saved thresholds are shared; filters are independent between views.

## Data

Reads the local app database without changing it. Explicit parent links take precedence over legacy creator references; historical session aliases are resolved.

Input/output totals are cumulative. Context shows the current window usage. Warning settings persist across chats. No conversations are read or uploaded. The extension must run on the computer hosting the app's metadata.

## Develop

Use Node 24 or later and the GitHub Copilot app with canvas extension support. No build or package installation is needed.

From this app's folder:

```sh
node --test monitor.test.mjs
```

After updating an installed copy, reload extensions and reopen existing browser tabs to load the current code and favicon. Cross-app browser and favicon checks are in `tests/`.

Fonts use [Geist](https://github.com/vercel/geist-font) ([license](fonts/LICENSE.txt)). Interface icons use [Phosphor Icons](https://github.com/phosphor-icons/core) ([license](icons/LICENSE)).

Logo: Lucide **Chart Column Increasing** ([license](LUCIDE-LICENSE.txt)) and Bricolage Grotesque ([license](FONT-LICENSE.txt)).

## Publish

Keep source, assets, and this README in `apps/context-monitor/`. Publish to `main`, then update installed copies. Keep session data, databases, and logs out of the repository.
