![Tracker logo](logo.svg)

Keep a work list for a release, a handoff, or your own projects. Update it in the canvas or ask Copilot to update it from a chat.

![Tracker showing release work items, statuses, updates, and an expanded subtask](screenshot-release-readiness.png)

## Use Tracker without a prompt

In the GitHub Copilot app, open **Canvas apps** and choose **Tracker**. If it isn't listed, [install it first](#install). Open the tracker menu and choose **New tracker**, or select a tracker you've already saved.

Choose **Add item** or select an item's title to edit it. Items can have an owner, an update, and a source link. Search titles, owners, and updates, or use **Filter by status**.

New items start at **To do** unless a status filter is active. Hover over a status or focus it with the keyboard to see what it means. For example, **Awaiting deployment** means the change is merged and isn't live yet. Use **Add status** for a custom label and an optional hover tip. [See all statuses](actions.md#built-in-statuses).

To add a subtask, pick a parent in **Add under**. Subtasks start collapsed; use the count at the right of a row to open them, or **Expand all** when several rows have subtasks. If a subtask matches a search or filter, its parent appears without expanding. Each subtask has its own status.

Link a Copilot session when you create a tracker or from the **Trackers** menu. The session name appears above the table and groups trackers in the menu. Choose **No session linked** to unlink it.

Trackers stay on this computer and can be opened from other local chats. Plans, pull requests, and sessions don't update them automatically.

## Track work from a coding session

If you want Copilot to fill in the tracker, paste this into the session where the work is happening. Replace `[tracker name]` with the name you want to use.

```text
Use the Tracker Canvas app to record the work from this coding session in
[tracker name]. Open that tracker, or create it if it doesn't exist.

Add one item per distinct task, not one per chat message. Update matching
items instead of duplicating them, and leave unrelated items alone.
Set each status based on what happened in this session. Add a short update
with any blocker, next step, or relevant pull request link.
Show me the tracker when you're done.
```

To link the tracker to the session as well, add: "Link this tracker to the current Copilot session."

To open a saved tracker from chat, you can just ask: "Open the Release readiness tracker in Tracker."

## Turn Thoughts into work items (optional)

Paste this into Copilot with both [Thoughts](../thoughts/README.md) and Tracker installed. Name a few thoughts, ask for all open thoughts, or ask for every saved thought, including completed ones.

```text
Turn [which thoughts to use] from Thoughts into work items in [tracker name].
Give each distinct task a clear title and keep useful context in its update.
Set new items to To do and skip duplicates. Ask before adding anything if
the tracker is missing or a thought doesn't describe a task. Leave Thoughts unchanged.
```

## Install

If **Tracker** already appears in **Canvas apps**, skip this step. Otherwise, paste this into a local Copilot chat. It installs Tracker for all your local chats without creating a tracker or linking one to the current session.

```text
Install or update Tracker as a persistent personal canvas extension from:
https://github.com/likamrat/ghcp-canvas-apps/tree/main/apps/tracker

Keep my saved trackers, reload extensions, and open Tracker. Don't create
a tracker or link one to this session.
```

[Canvas actions and status IDs](actions.md)
