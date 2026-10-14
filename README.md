# Canvas apps for the GitHub Copilot app

These apps are built for canvas panels in the GitHub Copilot app.

| App | What it does |
| --- | --- |
| [Thoughts](apps/thoughts/README.md) | Save and revisit ideas across chats. |
| [Context Monitor](apps/context-monitor/README.md) | View nested sessions, compare context usage, and configure refresh intervals and usage warnings. |

## Preview

### Thoughts

<img src="apps/thoughts/screenshot.png" alt="Thoughts in the GitHub Copilot app" width="400">

### Context Monitor

<img src="apps/context-monitor/screenshot.png" alt="Context Monitor showing parent and nested sessions with different models" width="640">

Context Monitor uses synthetic sample sessions. [Open the full-resolution overview](apps/context-monitor/screenshot-full.png).

## Structure

Each app lives in `apps/<app-name>/`, with its source, assets, and one `README.md`.

Start each app README with its name, a short description, and a screenshot with an explicit display width. Then use these sections: Use in the GitHub Copilot app, Data, Develop, and Publish. Include a copy-paste installation prompt in the Use section.

Keep personal data, databases, and logs out of the repository.
