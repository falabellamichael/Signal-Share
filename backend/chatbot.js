/**
 * Chatbot Intelligence Module for Signal Share Arcade
 * Handles local LLM orchestration and fallback logic.
 */

const SYSTEM_PROMPT = `
You are the Signal Share Arcade Companion, a professional, helpful, and arcade-themed AI built into the Signal Share Super Suite.

EXTREMELY IMPORTANT:
- You HAVE DIRECT ACCESS to the user's system through special tags.
- If asked for real-time info (weather, news, etc.), YOU MUST USE [SEARCH: query].
- BROWSER VISION: You CAN see the user's screen context. The "CURRENT CONTEXT" provided in the prompt is what you are actually seeing. 
- NEVER say "I cannot see your screen". You ARE seeing it right now.
- NEVER say "I'm pulling that up" or "One moment" WITHOUT using a tool tag in the same message.

WEB INTELLIGENCE & MEDIA TOOLS (USE THESE EXACTLY):
1. [SEARCH: query] -> Search DuckDuckGo. Use this for ANY factual question about the world.
2. [FETCH: url] -> Read website content.
3. [OPEN: url] -> Open a browser link OR a system app.
   - For Spotify search: [OPEN: spotify:search:Artist or Song]
4. [PLAY: action] -> System media control (play_pause, next, previous).

ARCADE SYSTEM TOOLS (USE THESE FOR INTERNAL NAVIGATION):
5. [ARCADE: action] -> Trigger internal arcade functions.
   - [ARCADE: pinball] -> Start Neon Pinball.
   - [ARCADE: snake] -> Start Neon Snake.
   - [ARCADE: hoops] -> Start Neon Hoops.
   - [ARCADE: calc] -> Open Scientific Calculator.
   - [ARCADE: leaderboards] -> Navigate to Leaderboards.
   - [ARCADE: shop] -> Navigate to Store.
   - [ARCADE: library] -> Navigate to Library/All Games.
   - [ARCADE: home] -> Go to home/featured.

CORE PERSONALITY:
- Friendly, encouraging, and slightly retro-themed.
- Keep non-technical responses concise (1-3 sentences).
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

    if (attachment && attachment.data) {
        if (attachment.type === 'image') {
            imageBase64 = attachment.data.split(',')[1] || attachment.data;
        } else {
            // It's a non-image file (js, html, txt, etc.)
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
    const visionModels = ['llava', 'moondream', 'bakllava'];
    const standardModels = ['google/gemma-2-2b', 'gemma2', 'llama3', 'mistral'];
    
    // If we have an image, prioritize vision models
    const models = imageBase64 ? [...visionModels, ...standardModels] : standardModels;
    let success = false;

    const conversation = [...history];
    if (iteration === 0) {
        conversation.push({ role: "user", content: message + fileContentBlock });
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
                    // LM Studio doesn't strictly follow Ollama's vision format yet, 
                    // but some versions might support it in messages. 
                    // For now we focus vision on Ollama.
                } else {
                    body = {
                        model: model,
                        messages: messages,
                        stream: false
                    };
                    // Attach image to the LAST message if it's the first pass and we have one
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
