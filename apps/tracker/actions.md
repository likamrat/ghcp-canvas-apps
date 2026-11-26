# Tracker action reference

Open the `work-tracker` canvas with `boardName` or `boardId`. Omit both to choose a tracker in the canvas.

| Action | Use it to |
| --- | --- |
| `list_boards` | Find a tracker by name. |
| `create_board` | Create a tracker, with an optional `sessionId`. |
| `get_board` | Read work items, versions, and statuses. Pass `includeDetails: true` to include subtasks. |
| `add_items` | Add work items. Supply `parentId` only for a subtask. Omit `statusId` to use `todo`. |
| `update_item` | Change an item. Send its ID, current version, and only the fields that changed. Set `hidden` to `true` or `false` to hide or restore it. If the version is stale, reread the tracker before retrying. |
| `remove_item` | Remove an item using its current version. Do this only when the user asks. |
| `add_status` | Add a status label with an optional `tooltip`. |
| `list_sessions` | Find a Copilot session and its ID. |
| `set_board_session` | Link a session. Pass an empty `sessionId` to clear the link. |

`get_board` still returns hidden items. To delete an entire tracker, use **Delete tracker** in the canvas.

## Built-in statuses

| Status | ID |
| --- | --- |
| To do | `todo` |
| In progress | `in-progress` |
| In review | `in-review` |
| Ready to merge | `ready-to-merge` |
| Awaiting deployment | `awaiting-deployment` |
| Blocked | `blocked` |
| Paused | `paused` |
| Done | `done` |

Use the IDs from `get_board`. A tracker with a custom Awaiting deployment status keeps that status's ID.
