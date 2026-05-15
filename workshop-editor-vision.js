/**
 * Signal Share Workshop Editor - Vision Integration
 * Enables the AI to use images/screenshots to guide code edits.
 */
(function initWorkshopVision(global) {
    const VISION_VERSION = "1.0";

    /**
     * Builds the vision-specific directive for the AI.
     * This is injected into the prompt when an image attachment is present in the Workshop Editor.
     */
    function buildWorkshopVisionDirective(editorContext = null) {
        const fileName = `${editorContext?.activeFileName || "index.html"}`.trim();
        
        return [
            "[VISION_DRIVEN_EDIT_PROTOCOL]",
            "An image has been attached to this request. You MUST use it as a visual reference for your code edits.",
            `TARGET FILE: ${fileName}`,
            "",
            "MAPPING INSTRUCTIONS:",
            "1. Analyze the attached image for layout, colors, spacing, or UI bugs.",
            "2. Correlate visual elements in the image with the provided code in the Workshop Editor.",
            "3. If the image shows a design you need to implement, translate visual styles into CSS/HTML properties.",
            "4. If the image highlights a bug, identify the corresponding code block that causes it.",
            "5. Use [EDIT] tags to apply surgical changes based on your visual analysis.",
            "",
            "COORDINATE MAPPING (VRAM OPTIMIZED):",
            "- Use your vision capabilities to pinpoint exactly where in the UI the changes are needed.",
            "- Translate 'the top right button' or 'the red text' into specific class names or IDs found in the code.",
            "- If the image contains text, search for that exact text in the code to find your bearings.",
            "[/VISION_DRIVEN_EDIT_PROTOCOL]"
        ].join("\n");
    }

    /**
     * Helper to check if a vision-driven edit is appropriate.
     */
    function shouldApplyVisionDirective(userPrompt = "", attachment = null, editorContext = null) {
        if (!attachment || attachment.type !== 'image') return false;
        if (!editorContext || !editorContext.activeGameId) return false;
        
        const text = `${userPrompt || ""}`.trim().toLowerCase();
        const hasVisualIntent = /\b(look|see|image|picture|screenshot|photo|design|mockup|ui|layout|style|color|this|that)\b/.test(text);
        
        return hasVisualIntent;
    }

    const api = {
        VERSION: VISION_VERSION,
        buildWorkshopVisionDirective,
        shouldApplyVisionDirective
    };

    global.SignalShareWorkshopVision = api;
    console.log(`[Workshop Vision] v${VISION_VERSION} initialized.`);
})(window);
