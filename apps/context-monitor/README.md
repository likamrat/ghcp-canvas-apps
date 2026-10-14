# Context Monitor

View your GitHub Copilot app sessions, models, and context usage in one canvas. Filter by pins or model, show a parent's nested sessions, and compare token usage.

<img src="screenshot.png" alt="Context Monitor showing parent and nested sessions, different models, and context usage" width="640">

Synthetic sample sessions with Claude, GPT, and Grok models. The compact pinned-only preview shows the filter controls and retains an unpinned parent for hierarchy. [Open the full-resolution overview](screenshot-full.png) for all 10 sample sessions and warning controls. Model names illustrate the interface, not guaranteed availability for an account.

## Use in the GitHub Copilot app

Paste this into a chat in the GitHub Copilot app:

```text
Install or update Context Monitor as a personal canvas extension from:
https://github.com/likamrat/ghcp-canvas-apps/tree/main/apps/context-monitor

Open Context Monitor when installation is complete.
```

Review the installation approval. Personal/user scope makes the canvas available across chats. The extension must run on the computer hosting the app's local metadata database; an unrelated remote or cloud machine cannot read it.

| Control | What it does |
| --- | --- |
| Parent arrow icon | Show or hide nested sessions. Hover or focus the icon for its description; top-level parents start collapsed. |
| Find a session | Search by name, project, model, or session ID. Matching children keep their parents visible. |
| Only pinned sessions | Show sessions you pinned in the GitHub Copilot app. This filters existing pins; it does not change them. |
| Filter by model | Choose a model currently used by an open (non-archived) session, or All models. Options update with the app's metadata. |
| Sort sessions | Choose recent activity (default), most/least context used, highest/lowest percentage used, largest context window, or name A-Z/Z-A. |
| Auto-refresh | Choose 5 seconds (default), 10 seconds, 30 seconds, 1 minute, 5 minutes, or Off. |
| Usage warnings | Set the Warning and High usage percentages, then Apply. Reset defaults restores 65% / 85%. |
| Session name | Show exact token counts, limits, and available breakdowns. |
| Include archived sessions | Include archived sessions, which are hidden initially. An empty checkbox means they are excluded. |
| Refresh | Read the latest saved app metadata immediately. |

Sorting keeps parent groups together. Context-based sorts rank each group by its highest or lowest matching value and expand it so relevant children are visible. Missing values go last. Auto-refresh preserves your sort and expansion choices, pauses while the canvas is hidden, and never overlaps reads. Off leaves manual Refresh available.

Pin, model, and search filters work together. A pinned child does not pin its parent, and pinning a parent does not automatically include its unpinned children. Necessary ancestors remain visible and are labeled **Parent of matching sessions**; the matching-session and high-usage counts exclude these context-only parents. Filtering reveals matching descendants; clear the filters to return to your expansion choices.

The model list comes from session metadata, not the account's available-model catalog. Archived-only models and sessions without a reported model do not create options. Including archived sessions can show archived matches for a selected model, but does not add archived-only models to the list. If a selected model is no longer used by an open session, the filter resets to All models with a visible notice.

Usage warning levels must be whole percentages from 0 to 100, with Warning below High usage. They are saved across views. The colored strip shows these ranges; the vertical marker shows actual usage. A fully colored strip does not mean the context window is full. Unknown usage is **N/A**, with a neutral dashed strip and no marker.

**What the token numbers mean.** Tokens are pieces of text that the model processes. **Input total** counts the tokens the model has read across the session's requests, including messages, history, and tools. **Output total** counts the tokens it has generated. Both appear in each compact row, including short sessions, and are the app's reported totals.

**Context** is different: it shows the tokens currently in the input window against that window's capacity. The percentage and strip use this reading, not the session's cumulative input/output totals. Select a session name for exact counts and explanations of **Input window limit** and **Reply output limit**. The latter is the maximum output for one response, not the amount already generated. Missing totals say **Not reported**; an actual zero remains zero.

## Data

The extension reads `$COPILOT_HOME/data.db` in SQLite read-only mode. `COPILOT_HOME` defaults to `~/.copilot`. It reads selected session, workspace, model, parent-link, context fields, and the sidebar's pinned-session IDs, not prompts, conversations, credentials, event logs, or repository code. Nothing is uploaded.

Context values are the app's last reported snapshot, not lifetime token totals or a live estimate. Idle and archived sessions may have old samples. Warning levels do not predict when Copilot will compact a conversation. Missing fields are not invented.

This is a local app-database adapter, not a public cross-session SDK API. Missing or incompatible databases produce an explicit error. Missing or malformed pin metadata disables the pinned-only filter with a warning, rather than guessing which sessions are pinned. Remote sessions appear only if the local app has their metadata. Historical CLI aliases, including pinned IDs, are normalized to one app session; detached sessions remain roots, and missing or hidden archived parents promote their children to roots.

Warning preferences are saved separately in `$COPILOT_HOME/extensions/context-monitor/artifacts/settings.sqlite`. Concurrent edits are version-checked and preserve your draft on conflict. Other views pick up changes on refresh. Search, pin/model filters, sorting, expansion, archive visibility, and refresh intervals are temporary per-view settings.

## Develop

Use the GitHub Copilot app with canvas extension support and Node 24 or later. No build step or package installation is needed.

Run tests from this app's folder:

```sh
node --test monitor.test.mjs
```

Reload extensions after editing an installed copy. The repository's `.github/extensions/context-monitor/extension.mjs` entry loads the app for local development.

`extension.mjs` wires the canvas and snapshot/settings actions. `source.mjs` reads app metadata; `model.mjs` handles usage, hierarchy, search, and sorting; `settings.mjs` saves warning preferences. `server.mjs` serves `index.html`, `app.js`, `style.css`, local fonts, and icons.

Tests cover synthetic SQLite data, read-only access, hierarchy, sorting, unknown telemetry, warning validation and conflicts, HTTP request checks, and refresh timing.

Bundled [Geist fonts](https://github.com/vercel/geist-font) use the SIL Open Font License 1.1 ([license](fonts/LICENSE.txt)). No font CDN requests are needed.

The trailing Show/Hide nested sessions icons use [Phosphor Icons](https://github.com/phosphor-icons/core) under MIT ([license](icons/LICENSE)), matching the icon family used in Thoughts.

## Publish

Keep the source, assets, screenshots, and this README in `apps/context-monitor/`. Push changes to `main`, then update the installed extension in the GitHub Copilot app.

Use synthetic content in screenshots. Keep app databases, session metadata, preferences, and logs out of the repository.
