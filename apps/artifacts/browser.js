(() => {
    const button = document.getElementById("open-browser");
    const status = document.getElementById("browser-status");
    if (new URL(location.href).searchParams.get("view") === "browser") {
        button.hidden = true;
        status.hidden = false;
        status.textContent = "Browser view. Keep the owning Copilot session running.";
        return;
    }
    button.addEventListener("click", async () => {
        button.disabled = true;
        status.hidden = false;
        status.textContent = "Opening browser...";
        try {
            const headers = { "content-type": "application/json", "x-canvas-popout": "1" };
            const monitor = document.querySelector('meta[name="monitor-token"]');
            const inbox = document.querySelector('meta[name="inbox-token"]');
            if (monitor) headers["x-monitor-token"] = monitor.content;
            if (inbox) headers["x-inbox-token"] = inbox.content;
            const input = button.dataset.sessionId ? { sessionId: button.dataset.sessionId } : {};
            const response = await fetch(new URL("api/open-browser", location.href), {
                method: "POST", headers, body: JSON.stringify(input),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "The browser could not be opened.");
            status.textContent = `Opened in ${result.browser}. It stays available when this canvas closes.`;
        } catch (error) { status.textContent = `Could not open in browser: ${error.message}`; }
        finally { button.disabled = false; }
    });
})();
