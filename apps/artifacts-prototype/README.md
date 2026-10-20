# Artifacts workspace prototype

Throwaway, interactive UI mock for choosing how to browse an agent session's outputs. It is **not** a registered canvas extension and has no connection to live sessions or agents.

From the repository root, with Node 24+:

```powershell
node apps\artifacts-prototype\server.mjs
```

Open `http://127.0.0.1:4318/?variant=A`.

- **A / Workspace:** session tree, artifact list, document reader and revision provenance.
- **B / Library:** visual artifact previews with a detail dialog.
- **C / Activity:** artifact-centered timeline beside a reader.

The bottom switcher changes `?variant=A|B|C`; arrow keys also switch when focus is outside a control. Try searching, changing sessions/types, including children, pinning artifacts, opening versions, and creating a sample note. **Ask agent** only prepares a copyable request; it never sends one.

All records are fictional in-memory fixtures and reset on reload. The image preview is the existing repository Screenshots app, labeled as a reference. Geist is served from the existing Context Monitor assets and remains covered by its font license.

The layout question is still open; none of these variants has been selected for production. Keep this prototype off the default branch until a direction is chosen.

Design direction: Framed sheet, seed `2063931592`, with the repository's existing Geist typography and neutral palette. The product-specific element is the artifact revision history, not a generic dashboard chart. The font warning is intentionally retained for repository consistency; no lint suppression is configured. Shadows are limited to floating dialogs, navigation, and the prototype switcher. Document callouts use a flat tone rather than an accent side border.
