/* Signal Share AI chatbot support layer. */
(function (global) {
  if (global.AIChatbotSupport) return;

  const VERSION = '1.1';
  const MAX_CONTEXT = 30000;
  const MAX_ACTIVE = 18000;
  const MAX_SIDE = 2200;

  const asText = (value = '') => value == null ? '' : `${value}`;
  const clean = (value = '') => asText(value).trim();
  const safeName = (value = '') => clean(value).replace(/[\\/]+/g, '_') || 'file.txt';

  function truncateMiddle(value = '', maxChars = 12000) {
    const source = asText(value);
    const limit = Math.max(500, Number(maxChars) || 12000);
    if (source.length <= limit) return source;
    const head = Math.floor(limit * 0.62);
    const tail = Math.max(220, limit - head - 120);
    return `${source.slice(0, head)}\n\n[...trimmed ${source.length - head - tail} chars for VRAM...]\n\n${source.slice(-tail)}`;
  }

  function getEditorState() {
    try { return typeof global.getWorkshopEditorState === 'function' ? global.getWorkshopEditorState() : null; }
    catch (_) { return null; }
  }

  function getGames() {
    try {
      const games = typeof global.getWorkshopManageableGames === 'function' ? global.getWorkshopManageableGames() : [];
      return Array.isArray(games) ? games : [];
    } catch (_) { return []; }
  }

  function getActiveGame(state = null) {
    const nextState = state || getEditorState() || {};
    const gameId = clean(nextState.activeGameId || nextState.gameId || '');
    return gameId ? getGames().find((game) => `${game && game.id || ''}` === gameId) || null : null;
  }

  function getFiles(game = null) {
    return (Array.isArray(game && game.files) ? game.files : [])
      .filter((file) => file && typeof file === 'object')
      .map((file) => ({ ...file, name: safeName(file.name || file.fileName || 'file.txt') }));
  }

  function decodeFile(file = null) {
    const raw = asText(file && (file.content || file.code) || '');
    if (!raw.startsWith('data:')) return raw;
    const comma = raw.indexOf(',');
    if (comma < 0) return '';
    const payload = raw.slice(comma + 1);
    try { return raw.slice(0, comma).includes('base64') ? atob(payload) : decodeURIComponent(payload); }
    catch (_) { return ''; }
  }

  function getEditorText() {
    const editor = global.document && global.document.getElementById('workshop-edit-file-content');
    if (!editor) return '';
    return typeof editor.value === 'string' ? editor.value : asText(editor.textContent || '');
  }

  function getActiveContent(state = null, game = null) {
    const editorText = getEditorText();
    if (editorText) return editorText;
    const nextState = state || getEditorState() || {};
    const direct = asText(nextState.activeFileContent || nextState.content || '');
    if (direct) return direct;
    const activeName = safeName(nextState.activeFileName || nextState.fileName || 'index.html');
    const match = getFiles(game || getActiveGame(nextState)).find((file) => safeName(file.name || file.fileName) === activeName);
    return decodeFile(match);
  }

  function languageFor(fileName = '', type = '') {
    const name = clean(fileName).toLowerCase();
    const mime = clean(type).toLowerCase();
    if (/\.html?$/.test(name) || mime.includes('html')) return 'html';
    if (/\.css$/.test(name) || mime.includes('css')) return 'css';
    if (/\.(js|mjs|cjs)$/.test(name) || mime.includes('javascript')) return 'javascript';
    if (/\.json$/.test(name) || mime.includes('json')) return 'json';
    if (/\.svg$/.test(name) || mime.includes('svg')) return 'xml';
    return 'text';
  }

  function getReferences(source = '') {
    const refs = new Set();
    const patterns = [/src=["']([^"']+)["']/gi, /href=["']([^"']+)["']/gi];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(asText(source)))) {
        const ref = clean(match[1]).split(/[?#]/)[0].replace(/^\.\//, '');
        if (ref && !/^https?:/i.test(ref) && !/^data:/i.test(ref)) refs.add(ref);
      }
    }
    return Array.from(refs);
  }

  function summarizeFile(file = null, options = {}) {
    const name = safeName((file && (file.name || file.fileName)) || options.name || 'file.txt');
    const content = options.content !== undefined ? asText(options.content) : decodeFile(file);
    const language = languageFor(name, file && file.type || options.type || '');
    return {
      name,
      language,
      chars: content.length,
      references: language === 'html' ? getReferences(content) : [],
      preview: truncateMiddle(content, options.maxChars || MAX_SIDE)
    };
  }

  function isAddFileRequest(prompt = '') {
    return /\b(add|create|make|generate)\s+(a\s+|new\s+|another\s+)?file\b/i.test(prompt)
      || /\b(add|create|make|generate)\s+\S+\.(html?|css|js|json|svg|txt)\b/i.test(prompt);
  }

  function buildSupportContext(prompt = '', richContext = {}, options = {}) {
    const state = richContext.workshopEditor || getEditorState() || {};
    const game = getActiveGame(state);
    const files = getFiles(game);
    const activeName = safeName(state.activeFileName || state.fileName || 'index.html');
    const activeSource = getActiveContent(state, game);
    const active = summarizeFile({ name: activeName, content: activeSource }, { content: activeSource, maxChars: MAX_ACTIVE });
    const refs = new Set(getReferences(activeSource).map((ref) => ref.toLowerCase()));
    const sideFiles = files
      .filter((file) => refs.has(safeName(file.name).toLowerCase()))
      .slice(0, 6)
      .map((file) => summarizeFile(file));
    const inventory = files.slice(0, 18).map((file) => ({
      name: safeName(file.name),
      language: languageFor(file.name, file.type || ''),
      chars: decodeFile(file).length,
      active: safeName(file.name) === activeName
    }));
    const outputContract = isAddFileRequest(prompt)
      ? 'Return only new file code block(s). Every code fence must include filename=<name.ext>.'
      : `Return exactly one complete code block for ${activeName}. No prose, no diff, no SEARCH/REPLACE.`;
    const payload = {
      version: VERSION,
      request: asText(prompt),
      activeFile: active,
      fileInventory: inventory,
      relevantSideFiles: sideFiles,
      outputContract,
      modelHints: ['Use the provided file inventory.', 'Do not ask what files exist.', 'Spend tokens on final code instead of explanation.']
    };
    return truncateMiddle(`[AI_CHATBOT_SUPPORT_V1]\n${JSON.stringify(payload)}\n\n[ACTIVE_FILE_SOURCE: ${activeName}]\n\`\`\`${active.language} filename=${activeName}\n${active.preview}\n\`\`\`\n[/AI_CHATBOT_SUPPORT_V1]`, options.maxChars || MAX_CONTEXT);
  }

  function optimizeChatPayload(payload = {}) {
    const message = asText(payload.message || '');
    const context = asText(payload.pageContext || '');
    const isEdit = /^\/(edit|fix|rewrite)\b/i.test(message) || /AI_CHATBOT_SUPPORT|DIRECT_EDITOR_WRITE|workshop editor/i.test(context + message);
    if (!isEdit) return payload;
    return { ...payload, history: [], attachment: null, message: truncateMiddle(message, 3500), pageContext: truncateMiddle(context, MAX_CONTEXT), aiChatbotSupport: true, vramOptimized: true };
  }

  function inspect() {
    const state = getEditorState() || {};
    const game = getActiveGame(state);
    return { version: VERSION, activeGameId: clean(state.activeGameId || state.gameId || ''), activeFileName: clean(state.activeFileName || state.fileName || ''), fileCount: getFiles(game).length, bridgeAware: true, vramOptimized: true };
  }

  global.AIChatbotSupport = { version: VERSION, buildSupportContext, optimizeChatPayload, summarizeFile, inspect, truncateMiddle, isAddFileRequest };
})(window);
