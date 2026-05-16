/**
 * AMD GPU Optimizations for Signal Share
 * Detects AMD hardware and applies performance tweaks for WebGL and UI.
 */

window.AMDOptimizations = (function() {
    let isAMD = false;
    let rendererName = "";
    
    // Detect GPU in the browser
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (debugInfo) {
                rendererName = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || "";
                const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || "";
                
                if (rendererName.toLowerCase().includes('amd') || 
                    rendererName.toLowerCase().includes('radeon') || 
                    vendor.toLowerCase().includes('amd')) {
                    isAMD = true;
                }
            }
        }
    } catch (e) {
        console.warn("[AMD Opt] Failed to detect GPU:", e);
    }
    
    if (isAMD) {
        console.log(`[AMD Opt] AMD GPU detected: ${rendererName}. Applying optimizations.`);
    }
    
    return {
        isAMD: isAMD,
        renderer: rendererName,
        
        /**
         * Get recommended settings for WebGL games
         */
        getWebGLSettings: function() {
            if (!isAMD) return {};
            
            return {
                // AMD sometimes prefers explicit instancing or reduced draw calls
                preferInstancing: true,
                // Reduce shadow map size slightly to reduce driver overhead
                shadowMapSize: 1024,
                // Suggest medium precision for shaders if highp causes issues
                shaderPrecision: 'mediump',
                // Enable anti-aliasing
                antialias: true
            };
        },
        
        /**
         * Get recommended settings for UI/CSS
         */
        getUISettings: function() {
            if (!isAMD) return {};
            
            return {
                // Enable GPU acceleration for CSS animations
                forceGpuAcceleration: true
            };
        },
        
        /**
         * Apply optimizations to a specific game or context
         */
        applyToGame: function(config = {}) {
            if (!isAMD) return config;
            
            console.log("[AMD Opt] Applying AMD specific tweaks to game config.");
            return {
                ...config,
                ...this.getWebGLSettings()
            };
        }
    };
})();
