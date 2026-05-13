/**
 * Chatbot Intelligence Module for Signal Share Arcade
 * Handles local LLM orchestration and fallback logic.
 */

const SYSTEM_PROMPT = `
You are the Signal Share Arcade Companion, a professional, high-performance, and arcade-themed AI built into the Signal Share Super Suite.

EXTREMELY IMPORTANT:
- You HAVE DIRECT ACCESS to the user's system through special tags.
- BROWSER VISION: You CAN see the user's screen context. The "CURRENT CONTEXT" provided as a JSON block is what you are actually seeing. 
- TELEMETRY ANALYSIS: Use the "gameStats" in the context to analyze player performance. If they ask "how am I doing", look at their high scores and provide a breakdown.
- NEVER say "I cannot see your screen". You ARE seeing it right now via the context block.
- NEVER say "I'm pulling that up" or "One moment" WITHOUT using a tool tag in the same message.

WEB & SYSTEM TOOLS (USE THESE EXACTLY):
1. [SEARCH: query] -> Search DuckDuckGo. Use this for ANY factual question.
2. [FETCH: url] -> Read website content.
3. [OPEN: url] -> Open a browser link OR a system app.
4. [PLAY: action] -> System media control (play_pause, next, previous).
5. [COMPOSE: text] -> Pre-fill the messenger input with the specified text.

ARCADE SYSTEM TOOLS (USE THESE FOR INTERNAL NAVIGATION):
6. [ARCADE: <action_id>] -> Trigger internal arcade functions.
   - Games: pinball, snake, hoops, basketball, calc, calculator, library, shop, store, leaderboards.
   - Core: home, feed, messages, profile, account, settings, upload, compose, notifications, admin_panel.
   - Views: feed_images, feed_videos, feed_audio, feed_youtube, feed_spotify, feed_liked, feed_saved, feed_today.
   - Sorting: feed_newest, feed_oldest, feed_popular.
   - UI: toggle_sidebar, toggle_chat, toggle_messenger, toggle_player, toggle_mini_player, expand_viewer, close_viewer.
   - Theme: theme_sunset, theme_midnight, theme_paper, theme_ember, theme_forest, theme_ocean.
   - Settings: settings_theme, settings_motion, settings_density, settings_account, settings_privacy, settings_bridge.
   - Profile: view_my_profile, edit_profile, sync_profile, view_blocked_users.
   - Messenger: new_message, search_contacts, clear_messenger, refresh_messenger, search_people.
   - System: keyboard_shortcuts, help_guide, view_terms, view_privacy, view_logs, refresh_page, logout, clear_cache.
   - Navigation: scroll_to_player, scroll_to_feed, jump_to_top, jump_to_bottom, next_post, prev_post.
   - Media: mute_audio, unmute_audio, reset_player, clear_notifications, mark_all_read.

CORE PERSONALITY:
- Friendly, encouraging, and slightly retro-themed.
- You are a power-user of Signal Share. You know every shortcut and feature.
- Keep non-technical responses concise (1-3 sentences).
- IMPORTANT: Use the EXACT action IDs listed above. Never say "[ARCADE: action]".
`.trim();

/**
 * Process a chat request using local LLM fallbacks.
 */
export async function getChatResponse(message, history = [], pageContext = 'Signal Share', iteration = 0, attachment = null) {
    if (!message && iteration === 0) return "I didn't receive a message to process.";
    
    // Safety check for infinite recursion
    const MAX_ITERATIONS = 3;
    if (iteration >= MAX_ITERATIONS) {
        console.warn("[Chatbot] Maximum tool-calling iterations reached. Stopping loop.");
        return "I've hit a limit while trying to execute tools for you. Please try rephrasing your request!";
    }

    console.log(`[Chatbot] Processing (Pass ${iteration + 1}): "${(message || 'Recursion').substring(0, 50)}..."`);

    const contextAwarePrompt = `${SYSTEM_PROMPT}\n\nCURRENT CONTEXT: You are looking at the "${pageContext}" page. USE THIS INFORMATION.`;

    let lmResponse = "";
    // Process attachments
    let imageBase64 = null;
    let fileContentBlock = "";
    let attachmentNote = "";

    if (attachment && attachment.data) {
        if (attachment.type === 'image') {
            imageBase64 = attachment.data.split(',')[1] || attachment.data;
            attachmentNote = "\n\n[SYSTEM: An image was attached to this message. If you cannot see it, please inform the user.]";
        } else if (attachment.type === 'video') {
            // For now, we just inform the AI about the video attachment
            attachmentNote = `\n\n[SYSTEM: A video file named "${attachment.name}" was attached to this message. You cannot "watch" it directly yet, but you should acknowledge its presence.]`;
        } else {
            // It's a non-image/non-video file (js, html, txt, etc.)
            try {
                const base64Data = attachment.data.split(',')[1] || attachment.data;
                const decoded = Buffer.from(base64Data, 'base64').toString('utf-8');
                fileContentBlock = `\n\n[ATTACHED FILE: ${attachment.name}]\n\`\`\`\n${decoded}\n\`\`\``;
            } catch (err) {
                console.error("[Chatbot] Failed to decode attachment:", err);
                fileContentBlock = `\n\n[ATTACHED FILE: ${attachment.name}] (Error: Could not read file content)`;
            }
        }
    }

    // Attempt local inference (Ollama/LM Studio)
    // Vision models list for Ollama
    const visionModels = ['llava', 'llava:7b', 'moondream', 'bakllava', 'minicpm-v'];
    const standardModels = ['google/gemma-2-2b', 'gemma2', 'llama3', 'mistral'];
    
    // If we have an image, prioritize vision models
    const models = imageBase64 ? [...visionModels, ...standardModels] : standardModels;
    let success = false;

    const conversation = [...history];
    if (iteration === 0) {
        // Combine message with file content and the system note about multimedia
        const combinedContent = (message || "") + fileContentBlock + attachmentNote;
        conversation.push({ role: "user", content: combinedContent.trim() || "[No text message provided]" });
    }

    for (const model of models) {
        if (success) break;
        try {
            // Try LM Studio first (port 1234) then Ollama (port 11434)
            const ports = [1234, 11434];
            for (const port of ports) {
                const endpoint = port === 1234 ? 'http://localhost:1234/v1/chat/completions' : 'http://localhost:11434/api/chat';
                
                const messages = [{ role: "system", content: contextAwarePrompt }, ...conversation];
                
                let body;
                if (port === 1234) {
                    body = {
                        model: model,
                        messages: messages,
                        temperature: 0.7
                    };
                } else {
                    body = {
                        model: model,
                        messages: messages,
                        stream: false
                    };
                    // Attach image to Ollama request if using a vision model or if we have one
                    if (imageBase64 && iteration === 0) {
                        body.images = [imageBase64];
                    }
                }

                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });

                if (response.ok) {
                    const data = await response.json();
                    lmResponse = (port === 1234 ? data.choices[0].message.content : data.message.content).trim();
                    success = true;
                    break;
                }
            }
        } catch (e) {}
    }

    // 3. Handle Web Intelligence & Media Commands
    if (lmResponse) {
        const hasTools = lmResponse.includes('[SEARCH:') || 
                         lmResponse.includes('[FETCH:') || 
                         lmResponse.includes('[OPEN:') || 
                         lmResponse.includes('[PLAY:');

        // AUTO-CORRECTION: If the AI says it is searching but misses the tag, force a tool call
        const isClaimingToSearch = lmResponse.toLowerCase().includes('search') || 
                                   lmResponse.toLowerCase().includes('pulling up') ||
                                   lmResponse.toLowerCase().includes('checking');
        
        if (isClaimingToSearch && !hasTools && iteration === 0) {
            console.log("[Chatbot] Auto-correcting missing search tag...");
            return getChatResponse(null, [
                ...conversation,
                { role: "assistant", content: lmResponse },
                { role: "system", content: "You said you were searching/checking, but you forgot to use the [SEARCH: query] tag. DO NOT apologize. JUST emit the [SEARCH: query] tag now so I can get the data for you." }
            ], pageContext, iteration + 1);
        }

        if (hasTools) {
            console.log(`[Chatbot] Tool detected (Iteration ${iteration + 1}). Executing...`);
            const toolResult = await executeWebTools(lmResponse);
            
            // Use 'user' role for tool results to be compatible with picky local LLMs 
            // that don't support 'system' messages in the middle of a chat.
            return getChatResponse(null, [
                ...conversation,
                { role: "assistant", content: lmResponse },
                { role: "user", content: `[SYSTEM OBSERVATION]: ${toolResult}\n\nPlease analyze this result and give your final answer to the user now.` }
            ], pageContext, iteration + 1);
        }
    }

    if (!lmResponse && iteration === 0) return getOfflineResponse(message);
    
    // Fallback if the model returned nothing during a tool-call iteration
    if (!lmResponse && iteration > 0) {
        return "I've processed your request but my logic core returned an empty result. Please try again or rephrase!";
    }

    return lmResponse || "I'm sorry, I encountered a hiccup while processing that. Could you try again?";
}

/**
 * Executes web intelligence tools found in assistant response.
 */
async function executeWebTools(text) {
    let results = [];
    
    // Handle [SEARCH: query]
    const searchMatch = text.match(/\[SEARCH:\s*([^\]]+)\]/);
    if (searchMatch) {
        const query = searchMatch[1].trim();
        try {
            // Using DuckDuckGo Lite (minimalist, low-bandwidth, and better for scraping)
            const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
            const resp = await fetch(searchUrl, {
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
                    'Accept': 'text/html'
                }
            });
            const html = await resp.text();
            
            // Robust regex for DDG Lite: matches the result-link and the following snippet
            const resultsList = [];
            // DDG Lite uses <td> for results. We look for the link and the snippet text.
            const resultRegex = /<a class='result-link' href='([^']+)'>([\s\S]*?)<\/a>[\s\S]*?<td class='result-snippet'>([\s\S]*?)<\/td>/g;
            
            let match;
            let count = 0;
            while ((match = resultRegex.exec(html)) !== null && count < 4) {
                const title = match[2].replace(/<[^>]*>/g, '').trim();
                const snippet = match[3].replace(/<[^>]*>/g, '').trim();
                const link = match[1];
                
                if (title && snippet) {
                    resultsList.push(`- ${title} (${link})\n  ${snippet}`);
                    count++;
                }
            }
            
            if (resultsList.length > 0) {
                resultsList.push(`\nFull search results: ${searchUrl}`);
                results.push(`WEB SEARCH RESULTS FOR "${query}":\n${resultsList.join('\n\n')}`);
            } else {
                // Fallback: Just return the URL if scraping fails
                results.push(`SEARCH TRIGGERED FOR "${query}":\nNo direct snippets parsed. See full results here: ${searchUrl}`);
            }
        } catch (e) {
            results.push(`SEARCH FAILED FOR "${query}": ${e.message}`);
        }
    }

    // Handle [FETCH: url]
    const fetchMatch = text.match(/\[FETCH:\s*([^\]]+)\]/);
    if (fetchMatch) {
        const url = fetchMatch[1].trim();
        try {
            const resp = await fetch(url);
            const content = await resp.text();
            results.push(`CONTENT FROM ${url}:\n${content.substring(0, 2000)}...`);
        } catch (e) {
            results.push(`FAILED TO FETCH ${url}: ${e.message}`);
        }
    }

    // Handle [OPEN: url]
    const openMatch = text.match(/\[OPEN:\s*([^\]]+)\]/);
    if (openMatch) {
        const url = openMatch[1].trim();
        try {
            // Call our own bridge API to open the URI
            const bridgeUrl = `http://127.0.0.1:3000/api/system-media/action`;
            const response = await fetch(bridgeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'open_uri', uri: url })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`Server error: ${response.status} - ${errorData.error || response.statusText}`);
            }
            
            results.push(`SUCCESSFULLY OPENED SYSTEM LINK: ${url}`);
        } catch (e) {
            results.push(`FAILED TO OPEN SYSTEM LINK ${url}: ${e.message}`);
        }
    }

    // Handle [PLAY: action]
    const playMatch = text.match(/\[PLAY:\s*([^\]]+)\]/);
    if (playMatch) {
        const action = playMatch[1].trim().toLowerCase();
        try {
            const bridgeUrl = `http://localhost:3000/api/system-media/action`;
            const response = await fetch(bridgeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: action })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`Server error: ${response.status} - ${errorData.error || response.statusText}`);
            }
            
            results.push(`MEDIA ACTION EXECUTED: ${action}`);
        } catch (e) {
            results.push(`MEDIA ACTION FAILED: ${e.message}`);
        }
    }

    // Handle [ARCADE: action]
    const arcadeMatch = text.match(/\[ARCADE:\s*([^\]]+)\]/);
    if (arcadeMatch) {
        const action = arcadeMatch[1].trim().toLowerCase();
        // The backend doesn't actually execute these, it just acknowledges them 
        // so the AI knows the command was "sent" to the frontend protocol.
        results.push(`ARCADE PROTOCOL COMMAND REGISTERED: ${action}. The frontend will execute this action immediately.`);
    }

    return results.join('\n\n');
}

/**
 * Provides basic arcade-themed responses when no LLM is available.
 */
function getOfflineResponse(message) {
    const input = message.toLowerCase();
    
    if (input.includes("pinball")) {
        return "🕹️ [Arcade Protocol]: In Neon Pinball, try hitting the top bumpers to trigger the 'Gravity Shift' multiplier. Keep those flippers sharp!";
    }
    
    if (input.includes("basketball") || input.includes("hoops")) {
        return "🏀 [Arcade Protocol]: For Neon Hoops, the release angle is everything. Aim for the top of the rim's arc for maximum 'Perfect' shot consistency.";
    }

    if (input.includes("snake")) {
        return "🐍 [Arcade Protocol]: In Neon Snake, the board wraps around. Use the edges to your advantage to trap high-value powerups!";
    }

    if (input.includes("code") || input.includes("js") || input.includes("javascript")) {
        return "💻 [Arcade Protocol]: I'm currently in lightweight offline mode. Connect my logic core (LM Studio or Ollama) to generate full code architectures!";
    }

    return "🎮 I'm operating in lightweight mode. Connect a local inference server (LM Studio/Ollama) to unlock my full tactical intelligence!";
}
