/**
 * /vram Command
 * Checks or flushes local model memory through the bridge.
 */
(function() {
    function say(message, isError = false) {
        if (typeof window.addChatMessage === 'function') {
            window.addChatMessage('ai', isError ? `⚠️ ${message}` : message);
            return;
        }
        if (typeof window.showFeedback === 'function') window.showFeedback(message, isError);
    }

    async function callFirstAvailable(paths, options = {}) {
        if (typeof window.bridgeFetch !== 'function') {
            return { ok: false, status: 0, message: 'Bridge communication is not available.' };
        }

        let lastResponse = null;
        for (const path of paths) {
            try {
                const response = await window.bridgeFetch(path, {
                    method: options.method || 'GET',
                    timeoutMs: options.timeoutMs ?? 5000,
                    suppressNetworkErrors: true,
                    body: options.body
                });
                lastResponse = response;
                if (response?.ok) return response;
                if (response?.status && response.status !== 404) return response;
            } catch (error) {
                lastResponse = { ok: false, status: 0, message: error?.message || 'Bridge request failed.' };
            }
        }
        return lastResponse || { ok: false, status: 0, message: 'Bridge request failed.' };
    }

    window.ArcadeCommandManager.register({
        id: 'vram',
        description: 'Check or flush local model VRAM.',

        execute: async (args, inputElement) => {
            const subcommand = `${args || ''}`.trim().toLowerCase() || 'status';

            if (subcommand.startsWith('status')) {
                const response = await callFirstAvailable([
                    '/api/local-llm/models',
                    '/api/llm/models',
                    '/api/local-llm/health'
                ], { method: 'GET', timeoutMs: 5000 });

                if (!response?.ok) {
                    say(`VRAM status unavailable. Bridge returned ${response?.status || 'no response'}.`, true);
                    if (inputElement) inputElement.value = '';
                    return true;
                }

                const data = await response.json().catch(() => null);
                const models = Array.isArray(data?.models) ? data.models : [];
                if (models.length > 0) {
                    say(`VRAM status: ${models.length} model${models.length === 1 ? '' : 's'} visible to the bridge.`);
                } else {
                    say('VRAM status: bridge is reachable, but no loaded model list was returned.');
                }
                if (inputElement) inputElement.value = '';
                return true;
            }

            if (subcommand.startsWith('flush') || subcommand.startsWith('unload') || subcommand.startsWith('clear')) {
                const response = await callFirstAvailable([
                    '/api/local-llm/unload',
                    '/api/llm/unload'
                ], {
                    method: 'POST',
                    timeoutMs: 15000,
                    body: JSON.stringify({ action: 'unload_all' })
                });

                if (response?.ok) {
                    say('VRAM flush request sent successfully.');
                } else {
                    say(`Failed to flush VRAM. Bridge returned ${response?.status || 'no response'}.`, true);
                }
                if (inputElement) inputElement.value = '';
                return true;
            }

            say('Unknown /vram option. Try /vram status or /vram flush.', true);
            if (inputElement) inputElement.value = '';
            return true;
        },

        getSuggestions: (args = '') => {
            const prompt = `${args || ''}`.trim().toLowerCase();
            return [
                { id: 'status', name: 'status', description: 'Check local model / VRAM status.' },
                { id: 'flush', name: 'flush', description: 'Unload local models and free VRAM.' }
            ].filter(item => !prompt || `${item.id} ${item.description}`.toLowerCase().includes(prompt));
        }
    });
})();