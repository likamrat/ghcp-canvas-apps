# Tracker action reference

Open the `work-tracker` canvas with `boardName` or `boardId`. Omit both to open Tracker without specifying a list. Use the **Trackers** menu to switch lists.

| Action | Use it to |
| --- | --- |
| `list_boards` | Find a tracker by name. |
| `create_board` | Create a tracker, with an optional `sessionId`. |
| `get_board` | Read work items, versions, and statuses. Pass `includeDetails: true` to include subtasks. |
| `add_items` | Add work items. Supply `parentId` only for a subtask. Omit `statusId` to use `todo`. |
| `update_item` | Send `boardId`, `itemId`, the current `version`, and a `changes` object containing only the fields to update. Set `changes.hidden` to `true` to hide the item or `false` to restore it. If the version is stale, reread the tracker before retrying. |
| `remove_item` | Delete an item using `boardId`, `itemId`, and its current `version`. Do this only when the user asks. A parent cannot be deleted while it has subtasks, even if they are hidden. |
| `add_status` | Add a status label with an optional `tooltip`. |
| `list_sessions` | Find a Copilot session and its ID. |
| `set_board_session` | Link a session. Pass an empty `sessionId` to clear the link. |

`get_board` still returns hidden items. To delete an entire tracker, use **Delete tracker** in the canvas.

## Built-in statuses

| Status | ID | When to use it |
| --- | --- | --- |
| To do | `todo` | Work has not started. |
| In progress | `in-progress` | Work is underway. |
| In review | `in-review` | Work is ready for feedback or is being reviewed. |
| Packaged | `packaged` | A package was built and checked. That does not mean it was merged or deployed. |
| Ready to merge | `ready-to-merge` | Review is complete and the change is ready to merge. |
| Awaiting deployment | `awaiting-deployment` | The change is merged, but is not live in the target environment yet. |
| Verified live | `verified-live` | The deployment was verified in the target environment. |
| Blocked | `blocked` | Work cannot continue until a blocker is resolved. |
| Paused | `paused` | Work is intentionally on hold. |
| Done | `done` | Work is complete. |

Use the IDs from `get_board`. A custom status that matches a built-in label keeps its ID and any custom tip, and its tag uses the built-in tint. Hover or keyboard focus reveals the tip without changing the tint.

Custom statuses named **Awaiting accessibility** or **Awaiting accessibility sign-off** use the same yellow as **In progress** and **Awaiting deployment**. Tracker does not add either accessibility status by default.
