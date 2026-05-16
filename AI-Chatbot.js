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
 * Send message to AI backend and display response
 */
async function sendMessage(message) {
  const text = message.trim();
  
  if (!text) return;

  // Add user message to UI
  addMessage('user', text);
  
  // Show typing indicator
  showTyping();

  try {
    const response = await fetch(CONFIG.aiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        history: chatHistory,
        pageContext: "", // Can add page context if needed
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
 * Update GPU usage display (mock implementation)
 */
function updateGpuUsage() {
  // Simulate GPU/VRAM usage based on message length
  const mockVramUsage = Math.floor(Math.random() * 1024);
  gpuUsageEl.innerHTML = `GPU: ${Math.round((mockVramUsage / 512) * 100)}% | VRAM: ${mockVramUsage}MB`;
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
