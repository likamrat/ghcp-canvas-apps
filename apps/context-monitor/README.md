# Context Monitor

## Overview

A single view of your GitHub Copilot app sessions and their context windows. Each session has one compact row with its model, last reported token usage, and a segmented context strip. Parents have a shaded row, a **Parent session** label, the total nested-session count, and an explicit **Expand / Collapse** button. Children are grouped directly underneath, with tree connectors, indentation, and **Nested session** or **Nested parent** labels.

Top-level parent branches start collapsed. **Expand** reveals the full nested hierarchy, including grandchildren; nested parents can also be collapsed independently. Standalone sessions are labeled **Root session**. Expansion choices survive automatic refreshes and remain local to the open view.

Use **Sort sessions** to choose **Recent activity** (default), **Most / Least context used**, **Highest / Lowest % used**, **Largest context window**, or **Name: A to Z / Z to A**. Context used sorts the actual token count; percentage sorts how full the window is; largest window sorts input capacity. Sessions or groups without reported values go last in either direction.

Parents and their nested sessions stay together. Context-based sorting ranks each group by its highest or lowest matching value, so a large nested context brings its parent group to the top. It also expands the groups to make those nested sessions visible. You can still collapse them afterward, and auto-refresh preserves the sort and your expansion choices. Searching ranks matching sessions, not hidden non-matching children.

The usage states are **Normal**, **Warning**, and **High usage**. By default, warning starts at 65% of input capacity and high usage at 85%. Open **Usage warnings** to change **Warning level (%)** or **High usage level (%)**, then choose **Apply**. Use whole percentages from 0 to 100, with warning lower than high usage. **Reset defaults** restores and saves 65% / 85%, including when you have unsaved edits. The legend, rows, and high-usage count update together.

These are visual thresholds, not predictions of when Copilot will compact a conversation. Missing telemetry is neutral and marked **N/A**, never treated as zero.

The strip is a 0-100% threshold scale: sage, amber, and rose segments show the configured ranges, and a contrasting vertical marker shows actual usage. Segment boundaries follow your settings; the full-colored strip does not mean the context window is full. Usage above 100% keeps its exact numeric percentage while the marker stops at the right edge. Unknown usage gets a neutral dashed strip with no marker.

Search by session, project, model, or session ID. Search keeps matching sessions' ancestors visible, even through collapsed branches; clear search to return to your expansion choices. The nested count includes all non-archived descendants (or archived descendants too when included), regardless of search. Choose a session name to inspect exact counts, input/output limits, and any system, conversation, tool, MCP, and buffer counts reported by the app. Include archived sessions with the checkbox; they are hidden initially.

## Preview

![Context Monitor with nested sessions and segmented sage, amber, and rose context strips](screenshot.png)

Synthetic sample sessions, not a user's saved metadata.

## Use in GitHub Copilot

Requires GitHub Copilot app with CLI canvas extensions, locally accessible app metadata, and a Node runtime supporting `node:sqlite` (Node 24 recommended).

In a Copilot chat, ask:

> Install this personal canvas extension as `context-monitor` from https://github.com/likamrat/ghcp-canvas-apps/tree/main/apps/context-monitor, then open Context Monitor.

Review the installation approval. User scope makes the monitor available across chats. The repository also includes a project discovery entry in `.github/extensions/context-monitor/extension.mjs` for developing the app here. A project installation shadows a user installation with the same name.

**Auto-refresh** offers **Off**, **5 seconds** (default), **10 seconds**, **30 seconds**, **1 minute**, and **5 minutes**. Refreshing pauses while the canvas is hidden. Changing the interval restarts the countdown; each countdown begins after the previous read finishes, so requests never overlap. **Off** disables automatic reads, including on returning to the canvas; **Refresh** still reads immediately. The canvas always reads once when opened.

Closing the canvas stops its server; reopening it reads the same app metadata and restores the default interval. No hosted site or GitHub Pages deployment is needed.

## Data

The extension opens `$COPILOT_HOME/data.db` in SQLite read-only mode; `COPILOT_HOME` defaults to `~/.copilot`. It reads selected session, workspace, project-name, parent-link, alias, and context-sample fields. It does not read prompts, conversations, credentials, session event logs, or repository code, and does not modify the database. Metadata is served only over a token-protected loopback endpoint, with no third-party requests.

This is an **app-specific local database adapter**, not a public cross-session SDK API. It checks required schema fields and reports missing/incompatible stores instead of manufacturing data. It works on the machine hosting `data.db`; a remote or cloud extension without that database cannot enumerate the desktop app. Remote sessions appear if the local app has synchronized their metadata.

Context values are the app's **last reported snapshot**, not lifetime token totals or an independently calculated live estimate. The last context-sample timestamp is shown when available. Idle/archived sessions may have old samples. Breakdown fields may be absent or overlap; the monitor does not sum them into a fabricated total.

Workspace bindings and historical CLI aliases are normalized into one app session. Project children use workspace creator links; chat children use chat/side-chat parent links. Detached sessions remain roots; fork ancestry is not treated as nesting. A missing or hidden archived parent promotes its visible child to the root. Cyclic links are detached with a warning.

No session metadata is committed or saved by this extension. Color preferences are saved locally in `$COPILOT_HOME/extensions/context-monitor/artifacts/settings.sqlite` and shared across Context Monitor views, sessions, and restarts. Only this separate preferences database is writable; the Copilot app database stays read-only. Simultaneous edits are version-checked, and conflicts preserve your draft for review rather than silently overwriting another view's settings. Other open views pick up saved changes on their next refresh.

Search, sort order, collapse, detail expansion, archive visibility, and refresh interval are transient per-view settings.

## Develop

From this app's folder:

```sh
node --test monitor.test.mjs
```

No packages or build step are required. Copilot supplies `@github/copilot-sdk`. Reload extensions after editing, then open **Context Monitor**. The agent-facing `snapshot` action reads the same metadata and configured context colors as the UI. `get_settings` reads the thresholds, defaults, and version; `set_thresholds` saves an explicitly requested change using that version.

`extension.mjs` wires canvas lifecycle; `source.mjs` owns the read-only app adapter; `model.mjs` owns context thresholds and tree filtering; `settings.mjs` owns versioned user preferences; `server.mjs` serves the renderer in `index.html`, `app.js`, and `style.css`. The UI uses the host's documented color tokens, with light/dark fallbacks, keyboard-accessible controls, and responsive rows. Typography uses locally bundled **Geist Sans** and **Geist Mono**, with 15px session names, 14px body text, and more spacious rows.

The unmodified variable WOFF2 fonts in `fonts/` come from [Vercel's Geist](https://github.com/vercel/geist-font), distributed in the `geist` 1.7.2 package under the SIL Open Font License 1.1. Their copyright notice and license are in `fonts/LICENSE.txt`. No font CDN requests or runtime packages are needed.

Tests use disposable synthetic SQLite fixtures and cover default/custom thresholds, preference persistence/reset/conflicts, unknown telemetry, nesting, search, aliases, archives, schema errors, read-only behavior, and HTTP access restrictions. Renderer tests use a controlled clock to verify each refresh interval, Off/manual mode, hidden-canvas pausing, and interval changes during in-flight reads.

## Publish

Keep the source, screenshot, and this README together in `apps/context-monitor/`. Commit and push to this repository's `main` branch to update the installation URL, then install or update the personal extension in Copilot.

Do not commit app databases, session metadata, logs, or screenshots containing personal session names.
