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
   - Add your GitHub Pages URL to `Redirect URLs`
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

### Local LLM & Fortress Mode Setup

The Arcade Companion is designed to run primarily on **Local LLM** infrastructure to ensure maximum privacy and zero latency. To enable the full "stacked" AI experience:

#### 1. Configure the Bridge
The bridge acts as the secure tunnel between the website and your computer.
- Navigate to the `backend/` directory.
- Create a `.env` file (see `.env.example` if available) and define your secrets:
  ```env
  SIGNAL_SHARE_BRIDGE_SECRET=your_secure_passphrase
  SIGNAL_SHARE_DEVICE_ID=your_hardware_fingerprint
  SIGNAL_SHARE_LOCAL_LLM_TOKEN=shared_phone_token
  # Optional LAN mode for phone access:
  SIGNAL_SHARE_BRIDGE_LAN=true
  # Optional explicit bind override:
  # SIGNAL_SHARE_BRIDGE_BIND=0.0.0.0
  ```
- Install dependencies and start the bridge:
  ```powershell
  npm install
  node backend/server.js
  ```
- In the app settings, set:
  - `Bridge URL (PC IP)` to your computer bridge URL, for example `http://192.168.1.50:3000`
  - `Local LLM Token` to the same value as `SIGNAL_SHARE_LOCAL_LLM_TOKEN`

#### 2. Secure with Fortress Mode
Fortress Mode protects your computer from unauthorized remote access:
- **Handshake Secret**: Only devices providing the matching `X-Bridge-Secret` header can execute system commands.
- **Hardware Locking**: Use the **Security Dashboard** in the Arcade Sidebar to lock the bridge to your specific device ID. The server will reject any commands coming from other hardware, even if they have your secret key.
- **Automatic IP Banning**: The `SecurityEngine` automatically applies permanent IP bans to any address attempting path traversal or brute-forcing your handshake.

#### 3. Connect your LLM
The bridge is compatible with any OpenAI-standard local server:
- **Ollama**: Run `ollama serve` and ensure your model is pulled.
- **LM Studio / LocalAI**: Start the local server on port `1234` or `8080`.
- In the Arcade Companion UI, select your model from the dropdown (e.g., Qwen 3.5, Gemma 4, or DeepSeek R1).

#### 4. Dashboard Management
Monitor your security status in real-time:
- Open the **Arcade Companion Sidebar**.
- Click the **Security** button (shield icon) or use the shortcut in the **Main Settings** panel.
- View live audit logs, manage active IP bans, and verify your hardware lock status.

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
