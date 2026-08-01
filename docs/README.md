# Signal Share

Signal Share is a static media-sharing website starter built with plain HTML, CSS, and JavaScript.

## What it does

- Publishes image, video, and audio posts from a browser form
- Stores uploaded media locally with IndexedDB when no backend is configured
- Preserves likes in local storage
- Supports search, sorting, tag browsing, saved posts, and per-post deletion
- Includes a spotlight panel, creator leaderboard, and format mix dashboard
- Opens posts in a docked mini-player that can expand into a full-screen viewer
- Supports YouTube and Spotify link posts with embedded playback
- Supports email sign-up, sign-in, and activation when Supabase Auth is enabled
- Supports author/admin deletion on the hosted feed when the matching policies are applied
- Supports Direct Messenger push notifications on the website/PWA and Android app when push is configured
- Includes seeded demo content so the feed is not empty on first load

## Run it

Open `index.html` directly in a browser, or serve the folder with any static file server.

## Install as an App

This repo is now scaffolded for two app paths:

- `PWA`: installable from a browser on Android and desktop
- `Capacitor Android`: package the same web app as a native Android app shell

### PWA

The web app now includes:

- `site.webmanifest`
- `service-worker.js`
- install icons in `icons/`

Once deployed over HTTPS, browsers that support installable PWAs can offer `Install app`.

### Capacitor Android

This repo now includes:

- `capacitor.config.json`
- `package.json`
- `scripts/prepare-capacitor-web.ps1`

The Capacitor flow stages the current static site into `dist/`, then points the Android shell at that folder.

After installing Node.js and Android Studio on your machine:

```powershell
npm install
npm run prepare:web
npx cap add android
npx cap sync android
npx cap open android
```

Then in Android Studio:

1. let Gradle sync
2. run the app on an emulator or phone
3. replace the generated launcher icons if you want custom polished branding

If you change the web app later, refresh the Android shell with:

```powershell
npm run cap:sync
```

## Wear OS

Wear OS should be a separate companion app, not a direct copy of the phone UI.

Recommended watch scope:

- unread message list
- quick reply
- playback controls
- simple latest-post glance view

Recommended stack:

- Kotlin
- Jetpack Compose for Wear OS
- the same Supabase backend used by the phone app

Keep the watch experience shallow and glanceable. The current web messenger/feed UI is too heavy to ship directly to a watch unchanged.

## Enable Live Posting

This site can run in two modes:

- Local mode: posts stay in the current browser
- Hosted mode: posts and uploaded media are shared through Supabase

To enable hosted posting on GitHub Pages:

1. Create a Supabase project.
2. In the Supabase SQL editor, run `supabase/schema.sql`.
3. In Supabase Authentication, enable Email as a sign-in provider and keep Confirm email turned on if you want activation emails.
4. In Supabase Authentication > URL Configuration:
   - Set `Site URL` to your GitHub Pages URL
   - Add the complete GitHub Pages app URL to `Redirect URLs`
   - Add each local app URL you actually use for Supabase Auth testing. For this app, use entries such as `http://localhost:3000/**` and `http://127.0.0.1:3000/**` when you need any local path. Do not enter the literal placeholder `http://localhost/:<port>`.
5. In Supabase Storage, confirm the `media` bucket exists and is public.
6. Open `config.js`.
7. Fill in:
   - `supabaseUrl`
   - `supabaseAnonKey`
   - optional: `adminEmails` for the frontend admin allowlist
8. Upload the updated `config.js` to GitHub along with your other site files.

Keep the default `posts` table name and `media` bucket name unless you also edit `supabase/schema.sql`.

After that:

- new posts will publish to the shared feed
- uploaded videos and audio will play in the docked player
- the feed will refresh on other devices automatically when the page regains focus and on a timed sync loop
- brand-new visitors will see the real hosted feed instead of the seeded demo posts
- authors can delete their own hosted posts, and configured admin accounts can delete any hosted post

## Enable Direct Social Publishing

The Publish overlay can save Social drafts locally without provider setup. Direct Social posting uses per-user provider connections so users connect their own accounts once, then later posts can be sent from the website or Android wrapper without a provider share handoff.

Apply `supabase/schema.sql` so Supabase creates the private `social_connections` and `social_oauth_states` tables plus the service-role-only Vault helpers used by the Edge Functions. Deploy both Social functions and keep their names in `config.js`:

- `supabase/functions/social-connect/index.ts`
- `supabase/functions/social-publish/index.ts`

The checked-in `supabase/config.toml` disables gateway JWT verification only for `social-connect`, because provider callbacks do not carry a Supabase user JWT. The function still verifies the signed-in user inside every browser POST, and it performs an additional database-backed administrator check before accepting OAuth configuration changes. `social-publish` keeps gateway JWT verification enabled. After deployment, `supabase functions list` must show `social-connect` with `verify_jwt` set to `false` and `social-publish` set to `true`.

The connected-account implementation supports direct posting through X, LinkedIn, Facebook Pages, and Instagram accounts returned by each user's OAuth connection. If a provider returns multiple connected accounts, the Socials panel lets the user choose the account before posting.

Keep these service-level values in Edge Function secrets:

- `SOCIAL_TOKEN_ENCRYPTION_KEY`: a long random secret used to encrypt stored provider tokens
- `SOCIAL_ALLOWED_RETURN_ORIGINS`: comma-separated production browser origins allowed after OAuth callbacks. Use origins only, without a path, for example `https://owner.github.io`. Local `localhost` / `127.0.0.1` URLs and `capacitor://localhost` are handled as explicit development app returns.
- `META_GRAPH_API_VERSION`: the Meta Graph API version shared by connect and publish operations. Publishing settings manages app keys only, so version upgrades remain server-controlled.

A signed-in Signal Share administrator can add or rotate provider application keys under **Settings > Publishing**:

- X OAuth client ID and optional client secret
- LinkedIn OAuth client ID and client secret
- Meta app ID and app secret shared by Facebook and Instagram

The browser sends these values only to `social-connect`. The function verifies that the caller is an unbanned member of `site_admins`, writes the normalized provider configuration to the encrypted `signal_share_social_oauth_config` entry in Supabase Vault, and returns only presence/source metadata to the settings page. Provider updates are merged under a database transaction lock so simultaneous edits cannot discard another provider's keys. Client secrets are never returned; client IDs appear only where OAuth requires them in the provider authorization redirect. Existing `X_OAUTH_*`, `LINKEDIN_OAUTH_*`, and `META_OAUTH_*` Edge Function secrets remain supported as a backward-compatible fallback until equivalent values are saved from Publishing settings.

There are two different redirect allowlists and they must not be mixed up:

- Supabase Auth > URL Configuration controls where Supabase sign-in returns to the Signal Share app. Put the production app URL and any local Supabase Auth test URLs there.
- X, LinkedIn, and Meta developer settings control where those providers return after account connection. Register this exact Edge Function callback URL in every provider app:

- `https://gswptxeikjmihdjxoiar.supabase.co/functions/v1/social-connect`

Do not register a GitHub Pages URL or localhost URL as the X, LinkedIn, or Meta provider callback. The Edge Function validates OAuth state, stores the connection, and then returns the browser to an allowed Signal Share app origin.

X must grant user scopes for posting and refreshable access, including `tweet.write` and `offline.access`. LinkedIn must grant `w_member_social`; the current connection flow also requests OpenID profile scopes so it can identify the connected member. Meta OAuth needs Page post access for Facebook and Instagram publishing access for Instagram accounts available to that Meta user. Facebook, X, and LinkedIn accept text with an optional link URL in the Social fields. Instagram direct publishing still needs a public image URL.

## Enable Messenger Push Notifications

Direct Messenger now supports two notification paths:

- `Web Push` for the website/PWA, including background notifications when the browser supports push
- `Android Push` for the Capacitor app shell through Firebase Cloud Messaging

### 1. Update the database

Rerun `supabase/schema.sql` so Supabase creates the `push_subscriptions` table and the registration RPCs used by the clients.
If you are using the Wear OS companion, rerun it again after watch push updates so `android_wear` subscriptions are accepted too.

### 2. Generate web push keys

Generate a VAPID key pair:

```powershell
npx web-push generate-vapid-keys
```

Put the public key in `config.js`:

- `webPushPublicKey`

Keep the private key for the Supabase Edge Function secret setup below.

### 3. Deploy the message notification function

This repo now includes:

- `supabase/functions/send-message-notification/index.ts`

Deploy it with the Supabase CLI or dashboard workflow, then set these secrets for the function:

- `WEB_PUSH_PUBLIC_KEY`
- `WEB_PUSH_PRIVATE_KEY`
- `WEB_PUSH_SUBJECT`
- `FCM_SERVICE_ACCOUNT_JSON`

`WEB_PUSH_SUBJECT` is usually a `mailto:` value such as `mailto:you@example.com`.

### 4. Configure Android push

For the Android app shell:

1. Create or reuse a Firebase project.
2. Add your Android app package to Firebase.
3. Download `google-services.json`.
4. Place it in:
   - `android/app/google-services.json`
5. Add the full Firebase service-account JSON as the `FCM_SERVICE_ACCOUNT_JSON` secret for the Supabase Edge Function.
6. Run:

```powershell
npm run cap:sync
```

Then reopen Android Studio and rebuild the app.

### 5. Let devices subscribe

After deployment:

1. Sign in to the site or app.
2. Open `Direct Messenger`.
3. Allow notifications when prompted.

The messenger will register the current browser/app instance against the signed-in account and use it for future direct-message notifications.

### Notes

- If the website is open and active, the messenger still uses the in-page chime immediately.
- Closed/background website notifications depend on browser push support. Desktop Chromium browsers work best; on iPhone/iPad, push requires the site to be added to the Home Screen.
- If the push function is not deployed yet, messages still send normally; only the closed-app/background notification part is skipped.

## Direct Messenger

The web app includes a real-time Direct Messenger with support for:

- Local chiming when active in the foreground
- Background push notifications via FCM (Android) or Web Push (Browser)
- Supabase-powered message sync and delivery status

## Arcade Companion A.I.

Signal Share features a deeply integrated, "stacked" AI assistant called the **Arcade Companion**. This AI is not just a chatbot; it is a system-aware agent capable of analyzing your performance and controlling the platform.

### Capabilities

- **Deep Telemetry Analysis**: The AI has real-time access to your gaming performance, including high scores, total playtime, and global ranks across the mini-game suite.
- **Rich Context Awareness**: It monitors the current state of the application, including the active media playing in the Hero Player, user account status, and UI configuration (e.g., if the messenger is open).
- **Programmatic Control**: Through the **Arcade Action Protocol**, the AI can execute system-level commands based on your natural language:
    - **Feed Automation**: Filter and sort the media feed (e.g., "Show me the most popular videos from today").
    - **Navigation**: Instantly jump to specific sections (e.g., "Take me to the global leaderboards").
    - **System Styling**: Change themes and UI states (e.g., "Switch to Midnight theme").
    - **Messenger Integration**: Use the `[COMPOSE]` tool to draft messages and focus the communication dock.
- **Multimodal Support**: Attach images, videos, or documents to your chat for the AI to analyze and discuss using vision-capable local models.

### Direct Local AI and Optional PC Bridge

Normal model discovery and chat do not require the Signal Share PC Bridge. Open the **Endpoints** tab, choose a provider, and test it directly:

- **LM Studio** defaults to `http://127.0.0.1:1234/v1` and uses its OpenAI-compatible model and chat endpoints.
- **Ollama** defaults to `http://127.0.0.1:11434` and uses `/api/tags` plus `/api/chat`.
- **OpenAI-compatible** accepts an explicit private or loopback `/v1` base URL. Public URLs, URL credentials, query strings, and fragments are rejected.

Direct mode sends only ordinary model/chat JSON. It never forwards the PC Bridge secret, local LLM token, device identifiers, browser auth tokens, or provider API keys. Direct mode therefore has no desktop control, media control, app launching, local-file tools, or MCP. Install the PC Bridge only when those extra capabilities are wanted.

Browser access requires the provider to allow the Signal Share page origin:

- Start LM Studio with web CORS enabled, for example `lms server start --cors`. Keep it bound to `127.0.0.1` unless LAN access is intentionally required.
- Ollama already permits loopback web origins. For the published site or another origin, add only the exact trusted origin before starting Ollama. In PowerShell, use `$env:OLLAMA_ORIGINS="https://falabellamichael.github.io"; ollama serve`.
- A browser may ask for Local Network Access before a public HTTPS site can contact localhost or a LAN endpoint. This permission is separate from Signal Share sign-in.

#### Optional: Install the PC Bridge

Select **Optional PC Bridge setup**, run the downloaded installer once, and allow the normal Windows confirmation. The installer creates a per-user runtime, starts it, and pairs the browser without requiring an administrator account. The default listener is loopback-only.

For a manual or explicit LAN setup, create `backend/.env` and configure a matching credential before enabling LAN mode:

```env
SIGNAL_SHARE_BRIDGE_SECRET=your_secure_passphrase
SIGNAL_SHARE_LOCAL_LLM_TOKEN=shared_phone_token
SIGNAL_SHARE_BRIDGE_LAN=true
# Optional explicit bind override:
# SIGNAL_SHARE_BRIDGE_BIND=0.0.0.0
```

Then install dependencies and start the Bridge:

```powershell
npm install
node backend/server.js
```

In Settings, enter the Bridge URL and matching credential, then select **Connect/test PC Bridge**. Do not expose the Bridge to a LAN without a secret or local LLM token.

#### Optional: Use LM Studio MCP Tools

Signal Share can use MCP tools configured by the current PC user in LM Studio while keeping its existing allowlisted bridge actions available. The bridge reads only MCP server labels from that user's LM Studio `mcp.json`; selecting a server does not grant its tools to ordinary chat messages.
Normal local chat continues to use the OpenAI-compatible endpoint; messages with a selected MCP tool use LM Studio REST API v1 `POST /api/v1/chat`, which is the LM Studio endpoint that supports installed MCP plugins.

1. In LM Studio 0.4.0 or newer, enable API authentication and enable **Allow calling servers from mcp.json** in Developer server settings.
2. Add only MCP tools you trust to LM Studio's `mcp.json`. Filesystem MCP servers may read or modify every folder they are allowed to access.
3. Keep a `SIGNAL_SHARE_BRIDGE_SECRET` or `SIGNAL_SHARE_LOCAL_LLM_TOKEN` configured in `backend/.env`; LM Studio MCP discovery and execution require a matching bridge credential from the browser.
4. Add the private LM Studio API token to `backend/.env`:

   ```env
   SIGNAL_SHARE_LM_STUDIO_API_TOKEN=your_lm_studio_api_token
   # Optional context length for MCP requests:
   # SIGNAL_SHARE_LM_STUDIO_MCP_CONTEXT_LENGTH=8000
   ```

5. Restart the Signal Share bridge, open the Companion **Security** dashboard, and select the LM Studio server this browser user may use. The tool panel reports when the private LM Studio token is still required.
6. Authorize exactly one MCP tool for a request by beginning the message with its exact tool name:

   ```text
   /mcp read_file
   Read ./backend/server.js and summarize the chat route.
   ```

   The backend sends `allowed_tools: ["read_file"]` for that request only. A selected server receives no MCP-enabled request unless the message contains an explicit `/mcp <tool_name>` directive. To authorize a write-capable tool, the message must explicitly name that write tool.

The filesystem MCP example is not a web search tool; web search requires a separate MCP server that provides web access. Do not store the LM Studio API token in frontend files, browser local storage, or source control. Signal Share's existing strict application and media tools continue to use their current bridge allowlists.

## Remote Media & PC Bridge

Signal Share can control playback on your local PC or Android device through dedicated media bridges.

### Desktop Bridge (PC)

The repository includes a Node.js-based bridge (`backend/server.js`) that:

- Binds to your PC's local loopback for secure system-level media control
- Supports Play, Pause, Next, and Previous actions for apps like Spotify and YouTube
- Reports "Now Playing" snapshots (title, artist, artwork) back to the Signal Share UI
- Includes a security-hardened setup script (`setup-companion.bat`) for easy installation

### Native Bridge (Android)

The Capacitor Android shell includes a native `PhoneNowPlayingHelper`:

- Interfaces with the Android MediaSession system to observe background playback
- Provides an "Open on Phone" handoff feature to launch web content directly into native apps
- Supports cross-device synchronization via Supabase real-time actions

### Mode Locking

The player UI now supports "Mode Locking," which intelligently switches controls between:

- `Feed Mode`: Controls the website's internal video/audio players
- `Media Mode`: Directs playback commands to your system bridge (PC or Phone) based on the active source toggle (YouTube or Spotify)

## Deployment to GitHub Pages

1. Create a GitHub repository and upload the files in this folder.
2. Push the repository to GitHub on the `main` branch.
3. In GitHub, open `Settings` > `Pages`.
4. Under `Build and deployment`, select `GitHub Actions`.
5. Push again after the workflow file is present, or run the workflow manually from the `Actions` tab.

After deployment, GitHub Pages will publish the site automatically from the workflow in `.github/workflows/static.yml`.

## Notes

- Uploaded posts are stored only in the browser profile where they were created unless Supabase is configured.
- Likes and saved posts are still browser-local, even when the media feed is hosted.
- If you update `supabase/schema.sql` after an earlier setup, rerun it in Supabase so the `author_id`, `site_admins`, and delete policies are applied.
