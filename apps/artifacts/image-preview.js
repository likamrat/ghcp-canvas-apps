const image = document.getElementById("image");
const status = document.getElementById("image-status");
const main = document.querySelector("main");
function fail(message) {
    image.hidden = true;
    status.hidden = false;
    status.setAttribute("role", "alert");
    status.textContent = message;
    main.setAttribute("aria-busy", "false");
}
function close() {
    window.close();
    // A manually opened browser tab may not allow scripts to close it.
    setTimeout(() => { if (!window.closed) fail("Use this window's close button to return to Artifacts."); }, 200);
}
document.getElementById("close-image").addEventListener("click", close);
document.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
});
image.addEventListener("load", () => {
    image.hidden = false;
    status.hidden = true;
    main.setAttribute("aria-busy", "false");
});
image.addEventListener("error", () => fail("This image could not be loaded. Close this window and refresh Artifacts to retry."));
try {
    const id = new URL(location.href).searchParams.get("id");
    if (!/^[a-f0-9]{64}$/.test(id ?? "")) throw new Error("Choose an image from Artifacts.");
    const response = await fetch(new URL(`api/content/${id}`, location.href));
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "This image is no longer available.");
    if (!["image", "diagram"].includes(result.metadata.kind) || result.metadata.availability !== "available") {
        throw new Error("This artifact is not an available image.");
    }
    document.title = `${result.metadata.name} - Artifacts`;
    image.alt = result.metadata.name;
    image.src = new URL(`file/${id}`, location.href).href;
} catch (error) { fail(error.message); }
