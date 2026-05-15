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
            "DOUBLE_PRECISION_MAPPING (VISUAL ANCHORING):",
            "1. STEP 1 (The Chatbot Helper): Analyze the image for any unique words, labels, text content, or specific headers. These are your 'Visual Anchors'.",
            "2. STEP 2 (The AI Precision): Search the provided code for these exact Visual Anchors. If 'Add Score' is seen in the image, find the string 'Add Score' in the code.",
            "3. COLLABORATION: Use the anchors to align the visual layout with the code structure. If a button is visually 'below' a specific text anchor, identify the corresponding DOM element in the code that follows that text.",
            "4. REFINEMENT: Before proposing the [EDIT], briefly list the text identifiers you found in the image that helped you locate the code section.",
            "5. ERROR PREVENTION: If the image contains text that is NOT in the provided code, use [FIND: 'unique word'] to ask the system to locate it in other parts of the project.",
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
