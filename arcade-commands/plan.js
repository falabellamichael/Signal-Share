/**
 * /plan Command
 * Converts the current chat turn into a planning request.
 */
(function() {
    const TOPICS = [
        'a GPU-optimized scroll system',
        'a state management system',
        'a media player controller',
        'a responsive UI layout',
        'a secure file upload flow',
        'a Workshop edit flow',
        'an arcade command workflow',
        'a local bridge recovery flow'
    ];

    function normalize(value = '') {
        return `${value || ''}`.trim();
    }

    window.ArcadeCommandManager.register({
        id: 'plan',
        description: 'Ask the AI for a structured implementation plan.',

        execute: async (args, inputElement) => {
            const topic = normalize(args);
            if (!topic) {
                if (typeof window.addChatMessage === 'function') {
                    window.addChatMessage('ai', '⚠️ Please provide a topic. Example: /plan a Workshop edit flow');
                }
                if (inputElement) inputElement.value = '';
                return true;
            }

            const planningPrompt = [
                '[PLAN_REQUEST]',
                'Create a concise implementation plan before writing code.',
                'Include: goal, files likely affected, exact steps, risks, and test checklist.',
                `Topic: ${topic}`
            ].join('\n');

            // Do not call sendChatMessage() from inside sendChatMessage().
            // Replace the active input and let the existing send pipeline continue.
            if (inputElement) inputElement.value = planningPrompt;
            window.activeArcadeCommandMode = '/plan';
            window.activeArcadeCommandModes = ['/plan'];
            return false;
        },

        getSuggestions: (args = '') => {
            const prompt = normalize(args).toLowerCase();
            return TOPICS
                .filter(topic => !prompt || topic.toLowerCase().includes(prompt))
                .map(topic => ({
                    id: topic,
                    name: topic,
                    description: `Plan ${topic}`
                }))
                .slice(0, 10);
        }
    });
})();