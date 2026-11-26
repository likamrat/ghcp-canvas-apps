# Product

<!-- impeccable:product-schema 1 -->

## Platform

Web canvas in the GitHub Copilot desktop app.

## Users and purpose

People can use Tracker to follow their own work or ask Copilot to update a shared list across their local chats. A coordinator is optional.

## Capabilities and constraints

Named trackers are shared across local Copilot chats. A tracker presents work items, filterable statuses, and progress notes. A live summary shows how top-level items are split by status, independently of search and status filters. Built-in statuses distinguish review, merge readiness, and deployment. Each tracker can also have custom statuses.

The table opens with subtasks collapsed. Each work item can have one level of subtasks. Tracker does not import session plans.

Users can hide or resize columns in the current view without changing the saved tracker. Table status tags stay on one line. The table and summary use the same status tints with neutral text. Long updates can be expanded from a two-line preview.

Users can hide items without losing them, restore hidden items, or delete an item or tracker after confirmation.

Each view can refresh manually or on a selected interval. Automatic refresh checks for saved changes from other chats without interrupting an open editor.

A tracker can reference a Copilot session, but the link is optional and does not change which chats can use it.

Tracker follows the existing Canvas apps' design language and keeps the status table compact enough to read beside a chat.
