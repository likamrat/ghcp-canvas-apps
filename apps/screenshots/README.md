# Screenshots

Browse uploaded images and tool-generated screenshots by GitHub Copilot session, without changing the original files.

<img src="screenshot.png" alt="Screenshots showing its controllers area, session navigator, and gallery with sample session data" width="800">

## Use in the GitHub Copilot app

Paste this into a chat after this app is published to `main`:

```text
Install or update Screenshots as a personal canvas extension from:
https://github.com/likamrat/ghcp-canvas-apps/tree/main/apps/screenshots

Open Screenshots when installation is complete.
```

Personal installation makes Screenshots available across projects and chats. The extension must run on the computer that holds the app's local metadata and image files.

## Controllers area

The panel below the title keeps the browsing controls together, following Context Monitor's layout.

| Controls | Behavior |
| --- | --- |
| Search sessions | Search session and project names without filtering image filenames. Matching children keep their parent context visible. |
| Include archived sessions | Show archived sessions and allow their images in the selected scope. Off initially. |
| Include child sessions | Include descendants of the selected session, with owning-session labels on images. Off initially. |
| Search filenames / Source | Combine a filename search with Uploaded, Tool-generated, or Unknown provenance. |
| From / To date | Inclusive local calendar dates. Invalid ranges show an error without applying an invalid query. |
| Sort by / Order | Timestamp, filename, or file size, ascending or descending. Missing values stay last; image IDs break ties consistently. |
| Group by | Day, source, or none. Groups follow the chosen direction; the selected sort applies within each group. |
| Thumbnail size | Small, medium, or large, preserving image aspect ratios. |
| Refresh | Re-read local metadata and image references, preserving valid filters and selection. No automatic refresh. |
| Clear filters | Clear session search, filename search, source, and dates. Keep session selection, scope toggles, sort, grouping, and thumbnail size. |

Initially the gallery uses newest timestamps first, grouped by day, with medium thumbnails. Select a session from the navigator, or use the compact session picker in a narrow canvas. Its scrollable menu always opens below the field. Arrow keys, Home/End, and typing navigate the options; Enter selects and Escape dismisses. Expand/collapse buttons only change the navigator; they do not change image scope.

Select a thumbnail to open its full-size preview. Use Fit, Actual size, zoom, Previous/Next, or the left/right arrow keys. Escape closes the viewer. Navigation follows the current filtered order, including images beyond the currently rendered gallery page.

## Sources and limitations

Screenshots reads the local app's `data.db` in read-only mode, resolves workspace/session aliases and parent relationships, and scans only the selected sessions' retained `events.jsonl` files. `COPILOT_HOME` selects the data directory; otherwise it uses `~/.copilot`.

Supported references:

- File attachments recorded on `user.message` events.
- Local image links in successful tool-result Markdown, including Playwright screenshot results.
- A successful screenshot tool call's `filename` or `path` argument when its result has no usable image link. Relative paths resolve against the recorded session working directory.

PNG, JPEG, GIF, and WebP are supported after checking their file headers. Inline-only attachments appear as unavailable when their metadata survives, but their image bytes are not reconstructed. Screenshots does not scan whole workspaces, inspect arbitrary images on disk, extract images from conversation prose, or collect new screenshots through hooks.

Some tools return images without retaining a local path. Screenshots cannot recover those bytes, files deleted with temporary workspaces, or files held only on cloud/remote hosts. Missing/unreadable references and unsupported history are shown explicitly. A known-image count is not a guarantee that every screenshot ever produced by a session is recoverable.

Timestamps use the recorded session event time, not a claim of exact capture time. If that is absent, file modification time is labeled as a fallback. Unknown timestamps stay visible without a date filter and are excluded when a date range is active. Day groups use this computer's local calendar dates; the browser uses its local timezone for displayed dates.

Discovery is bounded to 64 MiB of history per session identity, 128 MiB of history per scope, 32 identities per app session, 100 sessions and 10,000 images per scope, and 5,000 unique image references per session. Larger histories are not scanned; other limits produce partial-result warnings. Individual previews are limited to 32 MiB and 100 million pixels, with a supported header in the first 256 KiB. The gallery renders 120 images at a time and offers Show more. A file changed since indexing must be refreshed before it is served.

## Privacy and storage

Original images, session histories, and app metadata are never modified. Filters, catalog state, and zoom are temporary and do not survive extension reloads. No screenshot database, copied image collection, or background daemon is created.

Only attachment metadata and tool-result image references are extracted from the selected histories; message prose is not indexed. No data is uploaded, no remote URLs are fetched, and no OCR or AI image analysis runs. Image delivery uses a loopback-only HTTP server, per-panel capability URLs, indexed image IDs, and file identity checks rather than arbitrary-path HTTP access. Do not share a live capability URL.

## Develop

Use Node 24 or later and the GitHub Copilot app with canvas extension support. No build step or dependency installation is needed.

Run from this app's folder:

```sh
node --test model.test.mjs source.test.mjs server.test.mjs
```

The repository discovery entry is `.github/extensions/screenshots/extension.mjs`. The app folder is independently installable; it does not import a sibling app. Reload extensions after changing an installed copy.

The canvas ID is `screenshots`. Open input optionally accepts `sessionId`. Read-only actions are `list_sessions`, `query_images` (validated filters and a metadata page of at most 120 images), and `get_image` (metadata for a previously queried image). No action returns image bytes to the model.

For browser checks, use synthetic session metadata and reference images rather than private session data. Exercise the controllers, invalid dates, missing files, empty results, refresh recovery, session changes during discovery, preview keyboard navigation, and narrow/light/dark layouts.

## Publish

Keep source, assets, and this README under `apps/screenshots/`. Publish to `main` before using the installation URL above, then update installed copies through the app. Keep private screenshots, databases, histories, and logs out of the repository. The README image uses sample session metadata and the existing apps' public screenshots.
