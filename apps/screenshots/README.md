# Screenshots

Browse uploaded images and tool-generated screenshots by GitHub Copilot session, without changing the original files.

<img src="screenshot.png" alt="Screenshots showing its controllers area, session navigator, and gallery with sample session data" width="800">

## Use in the GitHub Copilot app

Paste this into a chat after this app is published to `main`:

```text
Install or update Screenshots as a personal canvas extension from:
https://github.com/likamrat/ghcp-canvas-apps/tree/main/apps/screenshots

Use persistent personal (user) scope, not project or session scope, so it is available across projects and chats after this conversation ends.
Keep the app's existing SDK canvas declaration: display name "Screenshots", canvas ID "screenshots".
Reuse an existing personal installation rather than creating duplicates, and preserve saved data and settings.

Reload extensions and verify that the personal provider is loaded and the canvas is registered.
Confirm that GitHub Copilot's Canvas apps list contains "Screenshots" as "Canvas · Personal", with a "New session" action.
If you cannot inspect that UI, clearly state what registration you verified and that the menu still needs a manual check.
Do not substitute a temporary preview, browser tab, skill, or project-only extension for installation.

Then open Screenshots.
```

After personal installation, open **Canvas apps**, find **Screenshots** labeled **Canvas · Personal**, and choose **New session**. It should remain available across projects and chats, not only in the installing conversation. A **Canvas · Project** entry is the repository's development copy, not a substitute for the personal installation. The extension must run on the computer that holds the app's local metadata and image files.

Choose **Open in browser** in the header to open the selected session in your normal system-default browser. The app uses the OS URL handler, with no app-mode window, forced Edge executable, or isolated browser profile; tab/window behavior follows your browser settings. The canvas remains open, and closing it does not stop the external browser view. Keep the owning Copilot session running; extension reload or session exit ends the old browser URL. Filters are independent between views.

## Controllers area

The panel below the title keeps image filters and display controls together, following Context Monitor's layout. Session search lives with the session navigator so the input, matching results, and selected session stay together.

| Controls | Behavior |
| --- | --- |
| Search sessions | Located directly above the session navigator and compact picker, not in the image controls. Matching sessions appear beneath the search as you type, with project names and a live result count. Click a result, press Enter for the first match, or use Arrow keys and Enter. No-match feedback is explicit. The navigator also filters while retaining matching children's parent context. |
| Include archived sessions | Show archived sessions and allow their images in the selected scope. Off initially. |
| Include child screenshots | Include screenshots from descendants of the selected session, with owning-session labels on images. Off initially. This changes gallery scope, not whether a navigator branch is expanded. |
| Search filenames / Source | Combine a filename search with Uploaded, Tool-generated, or Unknown provenance. |
| From / To date | Inclusive local calendar dates. Invalid ranges show an error without applying an invalid query. |
| Sort by / Order | Timestamp, filename, or file size, ascending or descending. Missing values stay last; image IDs break ties consistently. |
| Group by | Day, source, or none. Groups follow the chosen direction; the selected sort applies within each group. |
| Thumbnail size | Small, medium, or large, preserving image aspect ratios. |
| Screenshots per page | 8 by default, with 16 and 32 options. Previous/Next page controls show the page number and visible image range. |
| Download all | Save available images matching the current filters across every page in one ZIP. Unavailable images are skipped with a notice. |
| Refresh | Re-read local metadata and image references, preserving valid filters and selection. No automatic refresh. |
| Clear filters | Clear session search, filename search, source, and dates. Keep session selection, scope toggles, sort, grouping, and thumbnail size. |

Initially the gallery uses newest timestamps first, grouped by day, with medium thumbnails and eight screenshots per page. Parent branches start collapsed at every level; opening or selecting a nested session reveals only its ancestor path so the selection remains visible. Chevrons beside names expand one level at a time; indentation, connector lines, child counts, and Child of labels make the hierarchy explicit. Search temporarily reveals matching branches without changing collapse preferences. Expanding a branch never includes child screenshots automatically.

Changing session scope, image filters, sorting, grouping, or page size returns to page 1. Refresh preserves the current page when possible and clamps it to the last page if results shrink. Clear filters keeps the page size but returns to page 1. Select a session from the navigator, or use the compact session picker in a narrow canvas. Its scrollable menu always opens below the field. Arrow keys, Home/End, and typing navigate the options; Enter selects and Escape dismisses. The picker also identifies children by parent name.

Select a thumbnail to open its full-size preview. The **Zoom** controls show the current percentage with minus/plus buttons. **Reset zoom** restores the original preview size and scroll position; **Actual size** shows 100% of the image's pixels. Previous/Next and the left/right arrow keys follow the current filtered order, including images beyond the currently rendered gallery page. Escape closes the viewer.

Each screenshot has a small Lucide download button beside its caption. It saves the available original file or retained session image, without opening the preview. Unavailable images have disabled download buttons. **Download all** exports every available filtered result, not just the current page, as one `screenshots.zip`; numbered entries avoid collisions. ZIP downloads are limited to 128 MiB; narrow the filters or download individual images if the limit is exceeded. A changed image fails the export explicitly rather than producing a partial archive.

Explicit download clicks save through the extension to `Downloads` under the local user's home directory, avoiding unsupported blob-link downloads in embedded webviews. The status reports the completed file's full path only after writing and flushing it. Existing downloads are never overwritten: a numeric suffix is added to conflicting names. The canvas does not claim the browser saved a file merely because a link was clicked. No screenshot is saved automatically; original images and session storage stay unchanged. On remote setups, this is the Downloads folder of the machine running the extension, not a browser client's separate computer.

Use **Dismiss** to hide a download notification without deleting its file. Successful downloads also offer **Open in folder**, which reveals that screenshot or ZIP in File Explorer (Windows) or Finder (macOS); Linux opens its containing folder. The action only accepts a server-tracked completed download, not an arbitrary path. Moved/deleted files and file-manager launch failures are reported explicitly.

## Sources and limitations

Screenshots reads the local app's `data.db` in read-only mode, resolves workspace/session aliases and parent relationships, and scans only the selected sessions' retained `events.jsonl` files. Explicit `workspace_parent_links` take precedence over legacy creator references; chat links and historical aliases are also resolved. `COPILOT_HOME` selects the data directory; otherwise it uses `~/.copilot`.

Supported references:

- File attachments recorded on `user.message` events.
- Local image links in successful screenshot-tool results, including Playwright. Links in viewed source code, test fixtures, general tool output, and code blocks are not treated as captures.
- A successful screenshot tool call's `filename` or `path` argument when its result has no usable image link. Relative paths resolve against the recorded session working directory.
- Recorded image assets attached to uploads or actual binary tool results. Reading a source file containing an image path is not image evidence.

PNG, JPEG, GIF, and WebP are supported after checking their file headers. When an original file is missing or unreadable, Screenshots can read its existing `session.binary_asset` from retained history if an attachment or binary tool result links that asset to the image. Asset bytes are checked against their SHA-256 identity and preview limits. No files are recreated or copied. These previews are labeled **Retained session image** and may have been resized by the tool; dimensions describe the available preview, not the lost original. Inline attachments without retained bytes remain unavailable. Screenshots does not scan whole workspaces, inspect arbitrary images on disk, extract images from conversation prose, or collect new screenshots through hooks.

Some tools retain neither an image asset nor a usable local file. Screenshots cannot recover those bytes, images whose files and retained assets were both deleted, or files held only on cloud/remote hosts. Missing/unreadable references and unsupported history are shown explicitly. A known-image count is not a guarantee that every screenshot ever produced by a session is recoverable.

Timestamps use the recorded session event time, not a claim of exact capture time. If that is absent, file modification time is labeled as a fallback. Unknown timestamps stay visible without a date filter and are excluded when a date range is active. Day groups use this computer's local calendar dates; the browser uses its local timezone for displayed dates.

Discovery is bounded to 64 MiB of history per session identity, 128 MiB of history per scope, 32 identities per app session, 100 sessions and 10,000 images per scope, and 5,000 unique image references per session. Larger histories are not scanned; other limits produce partial-result warnings. Individual previews are limited to 32 MiB and 100 million pixels, with a supported header in the first 256 KiB. The gallery renders only the selected page of 8, 16, or 32 images. Group counts describe the whole filtered group, even when it spans pages. A file changed since indexing must be refreshed before it is served.

## Privacy and storage

Original images, session histories, and app metadata are never modified. Filters, catalog state, and zoom are temporary and do not survive extension reloads. Existing retained image assets are read on demand from indexed history offsets, not duplicated into a screenshot cache. No screenshot database, copied image collection, or background daemon is created. A server explicitly opened in a browser stays alive after canvas close until its owning extension exits.

Only attachment metadata and tool-result image references are extracted from the selected histories; message prose is not indexed. No data is uploaded, no remote URLs are fetched, and no OCR or AI image analysis runs. Image delivery uses a loopback-only HTTP server, per-panel capability URLs, indexed image IDs, and file identity checks rather than arbitrary-path HTTP access. Do not share a live capability URL.

## Develop

Use Node 24 or later and the GitHub Copilot app with canvas extension support. No build step or dependency installation is needed.

Run from this app's folder:

```sh
node --test model.test.mjs source.test.mjs server.test.mjs downloads.test.mjs
```

The repository discovery entry is `.github/extensions/screenshots/extension.mjs`. The app folder is independently installable; it does not import a sibling app. Reload extensions after changing an installed copy.

Cross-app browser-window and lifecycle checks live at `tests/browser.test.mjs` and run from the repository root.

The canvas ID is `screenshots`. Open input optionally accepts `sessionId`. Read-only actions are `list_sessions`, `query_images` (validated filters, an offset, and a metadata page defaulting to 8 images, up to 120), and `get_image` (metadata for a previously queried image). No action returns image bytes to the model.

For browser checks, use synthetic session metadata and reference images rather than private session data. Exercise the controllers, invalid dates, missing files, empty results, refresh recovery, session changes during discovery, preview keyboard navigation, and narrow/light/dark layouts.

The download glyph is from [Lucide](https://lucide.dev), used as an SVG in this dependency-free JavaScript app, with its [ISC/Feather MIT notices](icons/LICENSE). It is the same icon design available in `lucide-react`, without adding a React runtime.

## Publish

Keep source, assets, and this README under `apps/screenshots/`. Publish to `main` before using the installation URL above, then update installed copies through the app. Keep private screenshots, databases, histories, and logs out of the repository. The README image uses sample session metadata and the existing apps' public screenshots.
