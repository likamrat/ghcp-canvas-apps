# Context Monitor

See your GitHub Copilot app sessions, models, and context usage in one canvas.

<a href="screenshot-full.png?v=ea3c356aa484"><img src="screenshot.png?v=869949a5c605" alt="Context Monitor with paged sessions, a heat map, gradient usage bars, and sample GPT-6, GPT-6.1, and Claude sessions" width="640"></a>

## Use in the GitHub Copilot app

Paste this into a chat in the GitHub Copilot app:

```text
Install or update Context Monitor as a personal canvas extension from:
https://github.com/likamrat/ghcp-canvas-apps/tree/main/apps/context-monitor

Open Context Monitor when installation is complete.
```

Install in personal scope to make Context Monitor available from Canvas apps across chats.

Filter by model, pinned sessions, or context usage. Use the arrow at the end of a parent row to show its nested sessions.

Use Previous page and Next page to browse 8, 16, or 32 sessions at a time. The heat map counts only the tiles on that page, including collapsed sessions. Select a tile to inspect it.

Hide sessions without context data removes the dashed tiles. These mean the app has no reported context reading, not 0% usage.

Choose a refresh interval or refresh manually. Open Usage settings to change the warning levels or reset them to 65% and 85%. Select a session name for exact token counts.

## Data

Reads the app's local session database without changing it. Input totals count tokens read across requests; output totals count tokens generated. Context shows the current window usage.

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
