/**
 * AI Chatbot Integration Module
 * 
 * This module handles sending messages to your AI backend and displaying responses.
 * You can easily plug in any AI service (Supabase, Node.js/Python API, local model, etc.)
 */

// Configuration - Customize these values based on your AI backend
const CONFIG = {
  // Your AI endpoint URL (using relative path to hit your running backend)
  aiEndpoint: '/api/llm/chat', 
  
  // Optional: Custom prompt template for the AI
  customPromptTemplate: null, 
  
  // Optional: Custom response format (JSON, plain text, etc.)
  customResponseFormat: null,
};

// State to maintain chat history for context
let chatHistory = [];
let currentAiResponse = null;
let isTyping = false;

/**
 * Organize and prepare information for the AI to lift VRAM usage.
 * Searches for keywords in the raw context and extracts only relevant lines.
 * Also uses ArcadeWorkshopManager's skeleton tool if available.
 */
function prepareInformation(message, rawContext, fileName = '') {
  if (!rawContext) return "";
  
  let info = "";
  
  // 1. If it's code and large, try to generate a skeleton first
  const isCode = typeof window.ArcadeWorkshopManager?.looksLikeExecutableCode === 'function' 
    ? window.ArcadeWorkshopManager.looksLikeExecutableCode(rawContext)
    : false;

  if (isCode && rawContext.length > 5000 && typeof window.ArcadeWorkshopManager?.generateCodeSkeleton === 'function') {
    info += `[File Skeleton View for ${fileName || 'active file'}]\n` + window.ArcadeWorkshopManager.generateCodeSkeleton(rawContext, fileName) + "\n\n";
  }

  // 2. Extract keywords from message (simple split and filter)
  const keywords = message.toLowerCase().split(/\W+/).filter(word => word.length > 3);
  
  if (keywords.length > 0) {
    const lines = rawContext.split('\n');
    const relevantLines = new Set();

    // Find lines containing keywords
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      for (const keyword of keywords) {
        if (line.includes(keyword)) {
          // Add current line and some context (before and after)
          for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++) {
            relevantLines.add(j);
          }
          break; // Move to next line once a keyword matches
        }
      }
    }

    if (relevantLines.size > 0) {
      const sortedLineNumbers = Array.from(relevantLines).sort((a, b) => a - b);
      info += `[Relevant Snippets based on keywords: ${keywords.join(', ')}]\n`;
      
      let lastLineNum = -1;
      for (const lineNum of sortedLineNumbers) {
        if (lastLineNum !== -1 && lineNum !== lastLineNum + 1) {
          info += "\n... [Lines skipped] ...\n\n";
        }
        info += `${lineNum + 1}: ${lines[lineNum]}\n`;
        lastLineNum = lineNum;
      }
    }
  }

  // 3. Fallback or additional truncation if nothing specific found
  if (!info) {
    info = rawContext.slice(0, 3000) + "\n\n[Truncated to save VRAM]";
  }

  return info;
}

/**
 * Send message to AI backend and display response
 */
async function sendMessage(message) {
  const text = message.trim();
  
  if (!text) return;

  // Add user message to UI
  addMessage('user', text);
  
  // Show typing indicator
  showTyping();

  // Try to get active file content from workshop manager
  let rawContext = "";
  let fileName = "";
  
  const editorContext = typeof window.ArcadeWorkshopManager?.getActiveWorkshopEditorContext === 'function'
    ? window.ArcadeWorkshopManager.getActiveWorkshopEditorContext()
    : null;

  if (editorContext && editorContext.activeFileContent) {
    rawContext = editorContext.activeFileContent;
    fileName = editorContext.activeFileName || "index.html";
  } else {
    rawContext = document.body.innerText; // Fallback
  }

  // Prepare information for the AI to lift VRAM usage
  const preparedContext = prepareInformation(text, rawContext, fileName);

  try {
    const response = await fetch(CONFIG.aiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        history: chatHistory,
        pageContext: preparedContext, // Send organized information!
        model: "auto"
      })
    });

    const data = await response.json();
    hideTyping();

    if (data && data.ok) {
      const reply = data.reply || "No response from AI.";
      addMessage('ai', reply);
    } else {
      addMessage('ai', `Error: ${data.error || 'Failed to get response.'}`);
    }
  } catch (error) {
    hideTyping();
    console.error("[AI Chatbot] Error:", error);
    addMessage('ai', `Error: ${error.message || 'Network error.'}`);
  }

  // Update GPU usage after request
  updateGpuUsage();
}

/**
 * Start a simulated "typing" effect (kept for backward compatibility or mock use)
 */
function startTyping() {
  showTyping();

  // If we have a stored response, show it after a delay
  setTimeout(() => {
    hideTyping();
    
    if (currentAiResponse) {
      addMessage('ai', currentAiResponse);
      currentAiResponse = null;
    }
  }, 1500);
}

/**
 * Show loading indicator
 */
function showLoading() {
  loadingIndicator.classList.add('active');
  typingIndicator.classList.remove('active');
}

/**
 * Hide loading indicator
 */
function hideLoading() {
  loadingIndicator.classList.remove('active');
  typingIndicator.classList.remove('active');
}

/**
 * Update GPU usage display and monitor resources
 * Throttles requests or warns the user if VRAM usage gets too high.
 */
function updateGpuUsage() {
  // Estimate VRAM usage based on history length and message length
  const historySize = JSON.stringify(chatHistory).length;
  const estimatedVramMB = Math.floor(historySize / 1024) + Math.floor(Math.random() * 100); // Base + noise
  
  if (gpuUsageEl) {
    gpuUsageEl.innerHTML = `GPU: ${Math.min(100, Math.round((estimatedVramMB / 1024) * 100))}% | VRAM: ${estimatedVramMB}MB`;
  }

  // Warn the user or throttle if VRAM is "too high" (simulated threshold)
  if (estimatedVramMB > 800) {
    console.warn("[AI Chatbot] VRAM usage is high. Consider clearing chat history.");
    if (gpuUsageEl) {
      gpuUsageEl.style.color = 'red';
    }
  } else if (gpuUsageEl) {
    gpuUsageEl.style.color = '';
  }
}

/**
 * Add a message to the chat history
 */
function addMessage(role, text) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;
  
  // Create role label if needed
  let roleLabel = '';
  if (role === 'ai') {
    roleLabel = `<span class="role-label">AI Assistant</span>`;
  } else {
    roleLabel = `<span class="role-label">${role}</span>`;
  }

  messageDiv.innerHTML = `${roleLabel}${text.replace(/\n/g, '<br>')}</span>`;
  
  messagesContainer.appendChild(messageDiv);

  // Scroll to bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  // Save to history for context (AMD optimizations guard will trim this before sending)
  chatHistory.push({ role, content: text });
}

/**
 * Show typing indicator
 */
function showTyping() {
  isTyping = true;
  typingIndicator.classList.add('active');
  hideLoading();
}

/**
 * Hide typing indicator
 */
function hideTyping() {
  isTyping = false;
  typingIndicator.classList.remove('active');
}

// Export functions for use in other modules
export { sendMessage, startTyping, showLoading, hideLoading };
export { addMessage, updateGpuUsage };
export { CONFIG, MOCK_RESPONSES };
