/**
 * /vram Command
 * Flushes the VRAM by unloading models from the local inference server.
 */
(function() {
    window.ArcadeCommandManager.register({
        id: 'vram',
        description: 'Flush VRAM by unloading models.',
        execute: async (args, inputElement) => {
            if (typeof window.bridgeFetch !== 'function') {
                alert("Bridge communication not available.");
                return false;
            }
            
            try {
                // Try to unload models via the bridge
                const response = await window.bridgeFetch('/api/llm/unload', {
                    method: 'POST',
                    body: JSON.stringify({ action: 'unload_all' })
                });
                
                if (response.ok) {
                    alert("VRAM flush request sent successfully.");
                    if (inputElement) inputElement.value = '';
                    return true;
                } else {
                    // Try alternative endpoint if 404
                    if (response.status === 404) {
                        const altResponse = await window.bridgeFetch('/api/local-llm/unload', {
                            method: 'POST',
                            body: JSON.stringify({ action: 'unload_all' })
                        });
                        if (altResponse.ok) {
                            alert("VRAM flush request sent successfully.");
                            if (inputElement) inputElement.value = '';
                            return true;
                        }
                    }
                    alert("Failed to flush VRAM: " + response.statusText);
                }
            } catch (e) {
                alert("Failed to flush VRAM: " + e.message);
            }
            return false;
        }
    });
})();
