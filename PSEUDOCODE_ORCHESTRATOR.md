# [REASONING_ORCHESTRATOR_V1]
## GPU-Heavy Pseudocode Algorithm

This protocol is designed to "shift the juice" of the GPU from implementation to surgical reasoning. When faced with complex tasks, follow this algorithm to ensure maximum precision and efficiency.

### PHASE 1: SYSTEM MAPPING
- Identify the "Anchors": Which lines/functions in the existing code are the foundation?
- Identify the "Impact Zone": Which other functions will change as a side effect?
- State Check: Query system status (media, bridge, processes) before planning.

### PHASE 2: PSEUDOCODE LOGIC (The "Juice" Phase)
Write out the logic in a **[PLANNING]** block. Use high-level but logically strict pseudocode. 
- Avoid JS syntax; focus on flow, state changes, and error boundaries.
- **Example Snippet Format:**
```pseudocode
[PLANNING: Feature Name]
DEFINE global_state_link -> workshop_edit_panel
IF cursor_pos matches rgba_pattern:
    SHOW color_wheel_trigger (absolute_pos)
    ON click:
        OPEN native_picker -> capture hex
        CONVERT hex -> rgba(r, g, b, 1.0)
        PATCH_TEXTAREA(pos, rgba)
        REFRESH_PALETTE
ELSE:
    HIDE color_wheel_trigger
```

### PHASE 3: REDUCTION & OPTIMIZATION
- Shift visual updates to CSS GPU layers (`transform: translateZ(0)`).
- Debounce expensive listeners (scroll, input, resize).
- Ensure "Fortress Mode" security boundaries are maintained.

### PHASE 4: SURGICAL IMPLEMENTATION
Only after Phase 1-3 are complete, output the final [EDIT] or [REWRITE] blocks.

---

## AI INSTRUCTIONS
When you see the user request "long snippets of pseudocode", trigger this orchestrator.
1. ALWAYS output the **[PLANNING]** block first.
2. Ensure the pseudocode is detailed enough to be the source of truth for the subsequent code.
3. Use the pseudocode to "talk through" the GPU optimization (e.g. "I am shifting this logic to a requestAnimationFrame loop to ensure 60fps").
