/**
 * /plan Command
 * Requests a detailed pseudocode planning block from the AI before any implementation.
 */
(function() {
    window.ArcadeCommandManager.register({
        id: 'plan',
        description: 'Generate a [REASONING_ORCHESTRATOR_V1] plan for a feature.',
        execute: async (args, inputElement) => {
            if (!args) {
                if (typeof window.addChatMessage === 'function') {
                    window.addChatMessage('ai', '⚠️ Please provide a topic for the plan. Example: `/plan a GPU-optimized scroll system`.');
                }
                return true;
            }
            
            // Re-route as a regular message but prefixed with a planning instruction
            const planningPrompt = `[PLAN_REQUEST] Using the REASONING_ORCHESTRATOR_V1 protocol, please provide a detailed [PLANNING] block for the following: ${args}`;
            
            if (typeof window.sendChatMessage === 'function') {
                inputElement.value = planningPrompt;
                window.sendChatMessage();
                return true;
            }
            return false;
        },
        getSuggestions: (args = "") => {
            const prompt = `${args || ""}`.trim().toLowerCase();
            const topics = [
                'a GPU-optimized scroll system',
                'a state management system',
                'a media player controller',
                'a responsive UI layout',
                'a secure file upload flow'
            ];

            if (!prompt) {
                return topics.map(topic => ({
                    id: topic,
                    name: topic,
                    description: `Plan ${topic}`
                }));
            }

            return topics
                .filter(topic => topic.toLowerCase().includes(prompt))
                .map(topic => ({
                    id: topic,
                    name: topic,
                    description: `Plan ${topic}`
                }));
        }
    });
})();
