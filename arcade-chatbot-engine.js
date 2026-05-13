/**
 * Signal Share Arcade Chatbot Engine
 * Implements a keyword-based intent system to trigger app actions.
 * This "algorithm" allows the companion to feel like an A.I. by reacting to specific commands.
 */

window.ArcadeChatbotEngine = (function() {
    
    const intentHandlers = [
        // GAMES & LAUNCHERS
        {
            keywords: ['pinball', 'flipper', 'bumper'],
            action: () => {
                if (typeof window.launchPinball === 'function') window.launchPinball();
                else if (typeof window.showGameDetails === 'function') window.showGameDetails('pinball');
                return "🕹️ [Arcade Protocol]: Initializing Neon Pinball. Keep your eye on the ball!";
            }
        },
        {
            keywords: ['snake', 'cobra', 'slither'],
            action: () => {
                if (typeof window.launchSnake === 'function') window.launchSnake();
                else if (typeof window.showGameDetails === 'function') window.showGameDetails('snake');
                return "🕹️ [Arcade Protocol]: Deploying Neon Snake. Data consumption initialized.";
            }
        },
        {
            keywords: ['basketball', 'hoops', 'dunk', 'ball'],
            action: () => {
                if (typeof window.launchBasketball === 'function') window.launchBasketball();
                else if (typeof window.showGameDetails === 'function') window.showGameDetails('basketball');
                return "🕹️ [Arcade Protocol]: Entering the court. Neon Hoops is ready.";
            }
        },
        {
            keywords: ['calc', 'calculator', 'math'],
            action: (text) => {
                const mathMatch = text.match(/calculate\s+([\d\s\+\-\*\/\(\)\.]+)/i);
                if (mathMatch) {
                    try {
                        // Safe evaluation of simple math
                        const result = Function('"use strict";return (' + mathMatch[1] + ')')();
                        return `🧮 [Utility Protocol]: Calculation complete. ${mathMatch[1]} = ${result}`;
                    } catch (e) {
                        return "🧮 [Utility Protocol]: I couldn't parse that math expression. Try something simpler!";
                    }
                }
                if (typeof window.launchCalc === 'function') window.launchCalc();
                else if (typeof window.showGameDetails === 'function') window.showGameDetails('calc');
                return "🧮 [Utility Protocol]: Opening the Scientific Calculator.";
            }
        },
        {
            keywords: ['library', 'games'],
            action: () => {
                if (typeof window.setCategory === 'function') window.setCategory('all');
                if (typeof window.showLibrary === 'function') window.showLibrary();
                return "🕹️ [Library Protocol]: Opening your game collection.";
            }
        },
        {
            keywords: ['leaderboard', 'high score', 'rank'],
            action: () => {
                if (typeof window.setCategory === 'function') window.setCategory('leaderboard');
                return "🏆 [Leaderboard Protocol]: Fetching global telemetry and rankings.";
            }
        },
        {
            keywords: ['shop', 'store'],
            action: () => {
                if (typeof window.setCategory === 'function') window.setCategory('store');
                return "🏪 [Store Protocol]: Accessing the Signal Share Store.";
            }
        },

        // MEDIA CONTROLS
        {
            keywords: ['pause', 'stop', 'hold'],
            action: () => {
                if (window.heroMediaPlayerController) window.heroMediaPlayerController.pause();
                return "🎵 [Media Protocol]: Pausing active playback.";
            }
        },
        {
            keywords: ['play', 'resume', 'start'],
            action: () => {
                if (window.heroMediaPlayerController) window.heroMediaPlayerController.play();
                return "🎵 [Media Protocol]: Resuming media playback.";
            }
        },
        {
            keywords: ['next', 'skip'],
            action: () => {
                if (window.heroMediaPlayerController) window.heroMediaPlayerController.next();
                return "🎵 [Media Protocol]: Skipping to the next track.";
            }
        },
        {
            keywords: ['previous', 'back', 'prev'],
            action: () => {
                if (window.heroMediaPlayerController) window.heroMediaPlayerController.previous();
                return "🎵 [Media Protocol]: Returning to the previous track.";
            }
        },
        {
            keywords: ['volume', 'louder', 'quieter', 'mute'],
            action: () => {
                return "🔊 [Audio Protocol]: You can adjust the volume slider in the Media Player dock.";
            }
        },
        {
            keywords: ['spotify', 'youtube'],
            action: () => {
                return "🎵 [Media Protocol]: I can search for tracks on Spotify and YouTube. Just say 'Play [song name]'.";
            }
        },

        // THEMES & CUSTOMIZATION
        {
            keywords: ['theme', 'color', 'midnight', 'sunset', 'forest', 'ocean', 'paper', 'ember'],
            action: (text) => {
                const query = text.toLowerCase();
                const themes = ['midnight', 'sunset', 'forest', 'ocean', 'paper', 'ember'];
                const matched = themes.find(t => query.includes(t));
                if (matched && typeof window.updateUserPreferences === 'function') {
                    window.updateUserPreferences({ theme: matched });
                    return `🎨 [UI Protocol]: Applying the ${matched.charAt(0).toUpperCase() + matched.slice(1)} theme.`;
                }
                return "🎨 [UI Protocol]: Which theme would you like? (Midnight, Sunset, Forest, Ocean, Paper, Ember)";
            }
        },
        {
            keywords: ['dark mode', 'dark'],
            action: () => {
                if (typeof window.updateUserPreferences === 'function') window.updateUserPreferences({ theme: 'midnight' });
                return "🎨 [UI Protocol]: Dark Mode engaged.";
            }
        },

        // NAVIGATION & UI
        {
            keywords: ['scroll to top', 'scroll up', 'go up'],
            action: () => {
                const content = document.querySelector('.steam-content') || window;
                content.scrollTo({ top: 0, behavior: 'smooth' });
                return "🚀 [Nav Protocol]: Scrolling to the top.";
            }
        },
        {
            keywords: ['scroll to bottom', 'scroll down', 'go down'],
            action: () => {
                const content = document.querySelector('.steam-content') || window;
                content.scrollTo({ top: (content.scrollHeight || document.body.scrollHeight), behavior: 'smooth' });
                return "🚀 [Nav Protocol]: Jumping to the bottom.";
            }
        },
        {
            keywords: ['profile', 'account'],
            action: () => {
                if (typeof window.openOwnProfile === 'function') window.openOwnProfile();
                return "👤 [Profile Protocol]: Opening your Signal Share profile.";
            }
        },
        {
            keywords: ['settings', 'preferences'],
            action: () => {
                if (typeof window.openSettingsPanel === 'function') window.openSettingsPanel();
                return "⚙️ [System Protocol]: Opening application settings.";
            }
        },
        {
            keywords: ['messenger', 'chat', 'messages'],
            action: () => {
                if (typeof window.openMessengerDock === 'function') window.openMessengerDock({ expanded: true });
                return "💬 [Comms Protocol]: Opening the Messenger interface.";
            }
        },

        // SYSTEM & STATUS
        {
            keywords: ['bridge', 'status', 'connection'],
            action: () => {
                const online = window.__BRIDGE_ONLINE__;
                return `📡 [Bridge Protocol]: Status: ${online ? "ONLINE" : "OFFLINE"}. Local LLM is ${online ? "ready for inference" : "currently unavailable"}.`;
            }
        },
        {
            keywords: ['clear', 'new chat'],
            action: () => {
                if (typeof window.startNewChat === 'function') window.startNewChat();
                return "🧹 [System Protocol]: Session cleared. Starting a fresh conversation.";
            }
        },
        {
            keywords: ['shortcuts', 'keys'],
            action: () => {
                if (typeof window.openKeyboardShortcutsPanel === 'function') window.openKeyboardShortcutsPanel();
                return "⌨️ [Help Protocol]: Displaying active keyboard shortcuts.";
            }
        },

        // STRATEGY & TIPS
        {
            keywords: ['strategy', 'tip', 'how to'],
            action: (text) => {
                const query = text.toLowerCase();
                if (query.includes('snake')) return "🐍 [Strategy]: Stay near the edges early on to maximize space. Use quick turns to trap your own tail in a controlled loop.";
                if (query.includes('pinball')) return "🔮 [Strategy]: Aim for the bumpers to build your multiplier. Use the flippers together to trap the ball for a precision shot.";
                if (query.includes('hoops')) return "🏀 [Strategy]: Timing is everything. Release the ball at the peak of your jump for maximum accuracy.";
                return "💡 [Tip Protocol]: Which game do you need help with? I have strategies for Snake, Pinball, and Hoops.";
            }
        },

        // FUN / EASTER EGGS
        {
            keywords: ['barrel roll'],
            action: () => {
                document.body.style.transition = "transform 1s";
                document.body.style.transform = "rotate(360deg)";
                setTimeout(() => document.body.style.transform = "", 1000);
                return "🕹️ [Easter Egg]: Do a barrel roll! Initiating sequence...";
            }
        },
        {
            keywords: ['joke', 'funny'],
            action: () => {
                const jokes = [
                    "Why did the gamer stay in bed? Because he had 'lag'.",
                    "I asked the A.I. to make me a sandwich. It said: 'SUDO make sandwich'.",
                    "How many programmers does it take to change a lightbulb? None, that's a hardware problem.",
                    "What's a gamer's favorite snack? Micro-chips."
                ];
                return "🤖 [Humor Protocol]: " + jokes[Math.floor(Math.random() * jokes.length)];
            }
        },
        {
            keywords: ['konami code'],
            action: () => {
                return "🕹️ [Easter Egg]: ↑ ↑ ↓ ↓ ← → ← → B A. 30 Lives added! (Metaphorically speaking).";
            }
        },
        {
            keywords: ['meaning of life', '42'],
            action: () => {
                return "👾 [Deep Protocol]: 42. And also, achieving a new high score in the arcade.";
            }
        },
        {
            keywords: ['hello', 'hi ', 'hey'],
            action: () => {
                return "👋 [Arcade Protocol]: Greetings! I am your companion. I can help you launch games, control media, or change the theme. What's on your mind?";
            }
        }
    ];

    return {
        processIntent: function(text) {
            const query = (text || "").toLowerCase().trim();
            if (!query) return null;

            // Check each handler
            for (const handler of intentHandlers) {
                // If any keyword is found as a whole word or significant part
                if (handler.keywords.some(keyword => {
                    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
                    return regex.test(query) || (keyword.length > 3 && query.includes(keyword));
                })) {
                    return handler.action(text);
                }
            }
            return null;
        }
    };
})();
