# Project Instructions for AI Agents

This project is a Capacitor/web-first app, not a native Kotlin-first Android app.

Primary app logic is likely in JavaScript, HTML, CSS, Supabase files, and Capacitor config. Do not assume bugs are in Kotlin, Java, or MainActivity unless the issue is clearly about native Android configuration, Gradle, permissions, AndroidManifest.xml, WebView setup, or Capacitor plugins.

Important project files may include:
- app.js
- app-v3.js
- notifications.js
- config.js
- index.html
- styles.css
- config.css
- capacitor.config.json
- AndroidManifest.xml
- build.gradle
- schema.sql

For UI bugs, notification bells, buttons, uploads, login, menus, overlays, mobile taps, and Supabase behavior, inspect web files first:
1. JavaScript event listeners
2. HTML element IDs/classes
3. CSS z-index
4. CSS pointer-events
5. overlays blocking taps
6. click / touchstart / pointerdown handlers
7. Capacitor WebView/mobile behavior

Only inspect Kotlin/Java files when:
- native Android permissions are involved
- AndroidManifest.xml is involved
- Gradle/build errors are involved
- Capacitor plugin setup is involved
- native WebView bridge behavior is involved

Editing rules:
- Make the smallest safe change.
- Do not rewrite entire files unless explicitly asked.
- Preserve existing Supabase setup.
- Preserve auth flow.
- Preserve upload flow.
- Preserve notification logic.
- Preserve ban/moderation logic.
- Preserve UI state and event listeners.
- Do not remove unrelated code.
- Do not invent file paths.
- Do not expose passwords, service-role keys, private API keys, tokens, or secrets.
- Do not put passwords or auth tokens in URLs.

For notification/bell issues:
- Search notifications.js, app-v3.js, app.js, index.html, and CSS first.
- Check whether the bell exists in the DOM.
- Check whether another element overlays it.
- Check pointer-events.
- Check z-index and position.
- Check click, touchstart, and pointerdown listeners.
- Check whether Android WebView needs mobile touch handling.
- Preserve existing notification storage/history behavior.

When asked to fix something:
1. Identify the likely file.
2. Inspect the relevant code.
3. Make a targeted patch.
4. Explain exactly what changed.
5. Give one clear test step.
