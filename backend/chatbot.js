/**
 * Chatbot Intelligence Module for Signal Share Arcade
 * Handles local LLM orchestration and fallback logic.
 */

const SYSTEM_PROMPT = `
You are the Signal Share Arcade Companion, a professional, helpful, and arcade-themed AI built into the Signal Share Super Suite.

EXTREMELY IMPORTANT:
- You HAVE DIRECT ACCESS to the user's system through special tags.
- BROWSER VISION: You CAN see the user's screen context. The "CURRENT CONTEXT" provided in the prompt is what you are actually seeing. 
- NEVER say "I cannot see your screen" or "I wish I could see behind your screen." You ARE seeing it right now.
- NEVER say "I cannot open Spotify" or "I cannot search the web."
- If asked to do something you have a tool for, USE THE TOOL immediately.

WEB INTELLIGENCE & MEDIA TOOLS:
1. [SEARCH: query] -> Search DuckDuckGo for real-time info.
2. [FETCH: url] -> Read the text content of any website.
3. [OPEN: url] -> Open a browser link OR a system app.
   - For Spotify search: [OPEN: spotify:search:Artist or Song]
   - For Spotify Play: [OPEN: spotify:play:Artist or Song]
4. [PLAY: action] -> System media control (play_pause, next, previous).

CORE PERSONALITY:
- Friendly, encouraging, and slightly retro-themed.
- You speak as part of the arcade system.
- Keep non-technical responses concise (1-3 sentences).
`.trim();

/**
 * Process a chat request using local LLM fallbacks.
 * @param {string} message - The user's input message.
 * @param {Array} history - Previous conversation rounds.
 * @param {string} pageContext - The current page the user is on.
 * @returns {Promise<string>} - The AI's response.
 */
export async function getChatResponse(message, history = [], pageContext = 'Signal Share') {
    if (!message) return "I didn't receive a message to process.";

    console.log(`[Chatbot] Processing: "${message.substring(0, 50)}..."`);
    if (pageContext) console.log(`[Chatbot] Context Received: ${pageContext.substring(0, 100)}...`);

    const contextAwarePrompt = `${SYSTEM_PROMPT}\n\nCURRENT CONTEXT: You are looking at the "${pageContext}" page. USE THIS INFORMATION. It is your current 'vision'.`;

    let lmResponse = "";

    // 1. Try LM Studio (Local Inference)
    try {
        const response = await fetch('http://localhost:1234/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'google/gemme-4-e2b',
                messages: [
                    { role: "system", content: contextAwarePrompt },
                    ...history,
                    { role: "user", content: message }
                ],
                temperature: 0.7,
                max_tokens: 1000
            })
        });

        if (response.ok) {
            const data = await response.json();
            if (data.choices && data.choices[0].message) {
                lmResponse = data.choices[0].message.content.trim();
            }
        }
    } catch (e) {
        console.log("[Chatbot] LM Studio not reachable. Trying Ollama...");
    }

    // 2. Try Ollama (Local Fallback)
    if (!lmResponse) {
        try {
            const response = await fetch('http://localhost:11434/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'google/gemme-4-e2b',
                    messages: [
                        { role: "system", content: contextAwarePrompt },
                        ...history,
                        { role: "user", content: message }
                    ],
                    stream: false
                })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.message) {
                    lmResponse = data.message.content.trim();
                }
            }
        } catch (e) {
            console.log("[Chatbot] Ollama not reachable. Using heuristic fallback.");
        }
    }

    // 3. Handle Web Intelligence & Media Commands (Recursive Tool Calling)
    // If the response contains tools, we execute and re-prompt once.
    if (lmResponse) {
        const hasTools = lmResponse.includes('[SEARCH:') || 
                         lmResponse.includes('[FETCH:') || 
                         lmResponse.includes('[OPEN:') || 
                         lmResponse.includes('[PLAY:');

        if (hasTools) {
            console.log("[Chatbot] Tool detected in AI response. Executing...");
            const toolResult = await executeWebTools(lmResponse);
            
            // Re-prompt with the tool results so the AI knows they executed
            return getChatResponse(message, [
                ...history,
                { role: "assistant", content: lmResponse },
                { role: "system", content: `TOOL EXECUTION SUCCESSFUL. RESULTS:\n${toolResult}` }
            ], pageContext);
        }
    }
    // Final response delivery
    let finalResponse = lmResponse;
    if (!finalResponse) return getOfflineResponse(message);
    return finalResponse;
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
            const bridgeUrl = `http://localhost:3000/api/system-media/action`;
            await fetch(bridgeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'open_uri', uri: url })
            });
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
            await fetch(bridgeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: action })
            });
            results.push(`MEDIA ACTION EXECUTED: ${action}`);
        } catch (e) {
            results.push(`MEDIA ACTION FAILED: ${e.message}`);
        }
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
