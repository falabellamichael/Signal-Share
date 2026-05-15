/**
 * Workshop Color Assistant
 * Enables visual color discovery and insertion within the Workshop Editor.
 */
(function initWorkshopColorAssistant() {
    let colorPanelVisible = false;

    /**
     * Toggles the visibility of the color assistant panel.
     */
    window.toggleWorkshopColorAssistant = function() {
        const panel = document.getElementById('workshop-color-panel');
        const btn = document.getElementById('workshop-color-assistant-btn');
        if (!panel) return;
        
        colorPanelVisible = !colorPanelVisible;
        panel.hidden = !colorPanelVisible;
        
        if (colorPanelVisible) {
            btn.classList.add('active');
            window.scanForWorkshopColors();
        } else {
            btn.classList.remove('active');
        }
    };

    /**
     * Scans the current editor content for color strings and populates the palette.
     */
    window.scanForWorkshopColors = function() {
        const editor = document.getElementById('workshop-edit-file-content');
        const grid = document.getElementById('workshop-color-grid');
        const countEl = document.getElementById('workshop-color-count');
        if (!editor || !grid) return;

        const text = editor.value;
        
        // Regex patterns for various color formats
        const patterns = [
            /#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})\b/g, // Hex
            /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)/gi, // RGB/RGBA
            /hsla?\(\s*\d+\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(?:,\s*[\d.]+\s*)?\)/gi // HSL/HSLA
        ];
        
        let allMatches = [];
        patterns.forEach(re => {
            const matches = text.match(re) || [];
            allMatches = allMatches.concat(matches);
        });
        
        // Unique colors only
        const uniqueColors = [...new Set(allMatches)];
        
        grid.innerHTML = '';
        if (countEl) countEl.textContent = `${uniqueColors.length} detected`;

        if (uniqueColors.length === 0) {
            grid.innerHTML = '<div style="grid-column: 1/-1; font-size: 0.7rem; opacity: 0.3; padding: 20px; text-align: center;">No colors detected in file.</div>';
            return;
        }

        uniqueColors.forEach(color => {
            const wrapper = document.createElement('div');
            wrapper.style.display = 'flex';
            wrapper.style.flexDirection = 'column';
            wrapper.style.alignItems = 'center';
            wrapper.style.gap = '5px';

            const swatch = document.createElement('div');
            swatch.className = 'workshop-color-swatch';
            swatch.style.background = color;
            swatch.title = `Find: ${color}`;
            swatch.onclick = () => {
                if (window.findInWorkshopEditor) {
                    window.findInWorkshopEditor(color);
                }
            };

            const label = document.createElement('div');
            label.style.fontSize = '0.55rem';
            label.style.opacity = '0.4';
            label.style.width = '100%';
            label.style.textAlign = 'center';
            label.style.overflow = 'hidden';
            label.style.textOverflow = 'ellipsis';
            label.style.whiteSpace = 'nowrap';
            label.textContent = color;

            wrapper.appendChild(swatch);
            wrapper.appendChild(label);
            grid.appendChild(wrapper);
        });
    };

    /**
     * Triggered by hidden color input to insert a new color at cursor.
     */
    window.insertNewWorkshopColor = function(event) {
        const color = event.target.value;
        const editor = document.getElementById('workshop-edit-file-content');
        if (!editor) return;

        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const text = editor.value;
        
        // Convert hex to RGBA for consistency with user request
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        const rgba = `rgba(${r}, ${g}, ${b}, 1.0)`;
        
        editor.value = text.slice(0, start) + rgba + text.slice(end);
        
        // Position cursor after insertion
        const newPos = start + rgba.length;
        editor.setSelectionRange(newPos, newPos);
        editor.focus();
        
        // Trigger save listeners
        if (typeof window.handleWorkshopEditContentInput === 'function') {
            window.handleWorkshopEditContentInput();
        }
        
        // Refresh scan
        setTimeout(window.scanForWorkshopColors, 100);
    };

    /**
     * Opens the native color picker.
     */
    window.triggerWorkshopNativeColorPicker = function() {
        const input = document.getElementById('workshop-native-color-picker');
        if (input) input.click();
    };

    // Auto-scan on input if panel is open
    document.addEventListener('input', (e) => {
        if (e.target.id === 'workshop-edit-file-content' && colorPanelVisible) {
            window.scanForWorkshopColors();
        }
    });

    // Hook into global events if they exist
    window.addEventListener('workshop-editor-status-change', (e) => {
        // Optional: scan on success saves?
    });

    console.log('[Color Assistant] System ready.');
})();
