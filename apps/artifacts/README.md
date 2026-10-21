<p align="center">
  <img src="logo.svg" alt="Artifacts logo" width="440">
</p>

Find the documents, images, and files from a Copilot session without searching through its chat. Artifacts keeps source details beside each output and saves revisions of notes published through the app.

<img src="screenshot.png" alt="Artifacts showing filters and a document preview from an example session" width="640">

[Dark-theme view](screenshot-dark.png)

## Install

Artifacts runs as a personal canvas extension in the GitHub Copilot app. Paste this into a chat:

```text
Install or update Artifacts as a persistent personal canvas extension from:
https://github.com/likamrat/ghcp-canvas-apps/tree/main/apps/artifacts

Reuse an existing installation and preserve its notes, revisions, and pins.
Reload extensions in the GitHub Copilot app and verify Artifacts appears
in Canvas apps as "Canvas · Personal" with "New session".
If you cannot inspect that list, say so. Then open Artifacts.
```

## Use

Opens with the current session selected. Choose another session at the top or include its child sessions.

The session picker stays above the filters at every width. It has search, its own scrollbar, **Back to top**, and **Show selected**. These controls stay visible while the list scrolls. Use arrow keys and Enter to choose a session, or Escape to close.

[Session picker with example sessions](screenshot-sessions.png)

- The default workspace has an artifact navigator on the left and a preview on the right. **All artifacts** and **Pinned** change the collection. Search stays beside the list. Each row has a pin button that works without opening the file.
- The **List** menu offers **Gallery** for visual browsing and **Timeline** for dated artifact references. These are alternate views of the same collection, not steps in a workflow.
- **Filters and refresh** starts collapsed. Expand it to filter by type, source, or date. Type and Source accept multiple selections. Selections within a filter are combined; different filters narrow the results together.
- Sort by date, filename, or size. Timeline switches to date sorting. Browse 8, 16, or 32 artifacts per page.
- **Refresh** reads the selected scope again. Session changes show a loading indicator until discovery finishes. Refreshing the same session keeps its last results visible. **Auto-refresh** starts off and supports 5, 10, or 30 seconds, 1 minute, or 5 minutes. It pauses while hidden and preserves filters, selection, and page when they still apply.
- Select an artifact to open **Preview**, **Versions**, or **File info**. The reader toolbar has pin and download icons, a change-request action, and an edit icon for published notes. Images and SVG diagrams have zoom controls beside the preview. CSV and TSV files open as tables.
- Hash-like filenames use a short label in the navigator and reader. The original filename remains in **File info**, the title tooltip, and downloads.
- **New note** saves Markdown in Artifacts. **Edit note** saves another revision. Earlier captured revisions remain readable; original session files are unchanged.
- **Request a change** prepares a request to copy into Copilot chat. Selected document text is included. The canvas does not send messages to an agent.

**Open in browser** uses your system browser. Closing the canvas leaves that view running. Keep its Copilot session active; reloading extensions ends the old browser connection.

## Data

Local only. Reads the app's session metadata without changing it, then checks supported file references and session artifact folders. Remote files are not fetched. Missing files stay visible when a reference is retained.

Pins, published notes, and their revisions are saved in the app's own SQLite catalog under `$COPILOT_HOME/extensions/artifacts/artifacts/`, or `~/.copilot/extensions/artifacts/artifacts/` when `COPILOT_HOME` is unset. Removing or overwriting an original file does not create a recoverable revision. Revision history applies only to notes published through Artifacts.

Dates use local time and identify whether they came from a session event, file metadata, or publication. A tool reference means a tool used the file; it does not prove the tool created it. Discovery limits and inaccessible sources appear under **Discovery notes**.

Text previews are limited to 1 MiB and binary reads to 32 MiB. Table previews show up to 200 rows and 32 columns. Markdown supports headings, lists, checklists, links, and fenced code. Raw HTML in notes is displayed as text. PDF and Office files can be downloaded but do not have an embedded document editor.

## Agent actions

The canvas exposes `list_sessions`, `query_artifacts`, `get_artifact`, `read_artifact`, `register_artifact`, `list_revisions`, and `set_pinned`.

`register_artifact` publishes Markdown to a local session. Updating a published note requires its ID and expected version. `read_artifact` returns bounded text pages; image bytes are not included.

## Develop

Node 24+. No build step or package installation. From this folder:

```sh
node --test controls.test.mjs model.test.mjs session-picker.test.mjs render.test.mjs refresh.test.mjs server.test.mjs source.test.mjs store.test.mjs extension.test.mjs
```

For a standalone browser view of real local data:

```sh
node server.mjs <session-id>
```

Open the local URL printed by the server. After changing an installed copy, reload extensions in the GitHub Copilot app and reopen browser tabs. Cross-app browser, filter, and branding checks are in `tests/`.

The wordmark uses Bricolage Grotesque and replaces the second **a** in **artifacts** with Lucide's [hat-and-glasses icon](https://lucide.dev/icons/hat-glasses). The app header has a transparent background. Dark mode uses a light circle with a dark icon; light mode uses the colored icon on black. The app icon and favicon keep their black tile. See the [font license](FONT-LICENSE.txt) and [Lucide license](LUCIDE-LICENSE.txt).
