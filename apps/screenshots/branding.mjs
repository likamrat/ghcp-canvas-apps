export function inlineWordmark(svg) {
    const viewBox = svg.match(/data-header-view-box="([\d. ]+)"/)?.[1];
    const dimensions = viewBox?.split(" ").map(Number);
    const accent = svg.match(/class="word-icon"[^>]*color="(#[\da-f]{6})"/i)?.[1];
    if (dimensions?.length !== 4 || !dimensions.every(Number.isFinite) || dimensions[2] <= 0 || dimensions[3] <= 0 || !accent) {
        throw new Error("The bundled wordmark has no valid header bounds or icon color.");
    }
    const width = Math.round(dimensions[2] / dimensions[3] * 34);
    return svg
        .replace(/<svg\b[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="34" viewBox="${viewBox}" style="--wordmark-accent:${accent}" aria-hidden="true" focusable="false">`)
        .replace(/<title>[^<]*<\/title>\s*/, "")
        .replace(/<rect class="wordmark-background"[^>]*\/>\s*/, "")
        .replace(/class="(word-prefix|word-suffix)" fill="#000000"/g, 'class="$1" fill="currentColor"');
}
