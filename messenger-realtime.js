/**
 * Messenger Realtime System (v2 - FIXED)
 * Dedicated file for live notifications and badge updates.
 */

window.MessengerRealtime = class MessengerRealtime {
  constructor(appState) {
    console.log("[Realtime] MessengerRealtime class instantiated.");
    this.state = appState;
    this.channel = null;
    this.sessionHash = Math.random().toString(36).substring(2, 10);
    this.isConnecting = false;
    this.processedMessageIds = new Set(); // Prevent double-counting messages in same session
    this.hasReportedError = false;
    this.lastStatus = null;
    this.retryTimeout = null;
    this.heartbeat = null;
  }

  // Improved stop with proper cleanup
  stop() {
    console.log("[Realtime] Stop called");
    this.isConnecting = false;
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.channel) {
      console.log("[Realtime] Removing channel...");
      try {
        this.channel.unsubscribe();
        // Clean up channel from Supabase instance
        if (this.state.supabase && typeof this.state.supabase.removeChannel === 'function') {
          this.state.supabase.removeChannel(this.channel);
        }
      } catch (e) {
        console.warn("[Realtime] Error removing channel:", e);
      }
      this.channel = null;
    }
  }

  normalize(row) {
    return {
      id: row.id,
      threadId: row.thread_id,
      senderId: row.sender_id,
      body: row.body,
      createdAt: row.created_at,
      attachmentKind: row.attachment_kind,
      attachmentName: row.attachment_name,
      attachmentUrl: row.attachment_url
    };
  }

  // Main init method with proper checks and improved error handling
  init() {
    console.log("[Realtime] Init called, checking conditions...");
    
    // Check all prerequisites first
    if (!this.state.supabase) {
      console.warn("[Realtime] Supabase not initialized, cannot start realtime.");
      return;
    }
    if (!this.state.currentUser) {
      console.warn("[Realtime] No current user, cannot start realtime.");
      return;
    }
    if (this.isConnecting || this.channel) {
      console.log("[Realtime] Already connecting or connected, skipping init.");
      return;
    }

    // Cleanup before connecting
    this.stop();

    this.isConnecting = true;

    const userId = this.state.currentUser.id;
    const channelName = `messenger_live_${userId.slice(0, 8)}`; 
    
    console.log("[Realtime] Attempting to subscribe to channel:", channelName);

    try {
      this.channel = this.state.supabase.channel(channelName)
        .on("postgres_changes", { 
          event: "INSERT", 
          schema: "public", 
          table: "messages" 
        }, (payload) => {
          this.handleNewMessage(payload.new);
        })
        .on("broadcast", { event: "new-message" }, (payload) => {
          this.handleNewMessage(payload.payload);
        })
        .subscribe((status, err) => {
          if (status === "SUBSCRIBED") {
            console.log("[Realtime] Successfully connected to realtime channel!");
            this.isConnecting = false;
            this.hasReportedError = false;
            this.lastStatus = "SUBSCRIBED";
            return;
          } 
          
          // Handle connection errors
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED" || err) {
            console.log("[Realtime] Connection status:", status, "-", err?.message || "");
            
            this.isConnecting = false;
            this.lastStatus = status;

            // Only log error once to prevent spamming
            if (!this.hasReportedError) {
              console.error("[Realtime] Transport issue. Retrying in background...", err || status);
              this.hasReportedError = true;
              
              // Clear existing retry timeout
              if (this.retryTimeout) {
                clearTimeout(this.retryTimeout);
                this.retryTimeout = null;
              }
            }

            // Implement exponential backoff for retries
            const maxRetries = 5;
            let retryCount = this.processedMessageIds.size / 20; // Estimate from messages processed
            
            if (!this.retryTimeout) {
              // Calculate delay with exponential backoff (1s, 3s, 6s, 12s, up to 30s)
              const baseDelay = 1000;
              const maxDelay = 30000;
              let delay = Math.min(baseDelay * Math.pow(1.5, retryCount), maxDelay);
              
              this.retryTimeout = setTimeout(() => {
                console.log("[Realtime] Retrying connection after", delay / 1000, "seconds");
                this.retryTimeout = null;
                this.init(); // Try reconnecting
              }, delay);
            }
          }
        }, 20000);

      // Heartbeat with exponential backoff
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        if (!this.channel || !this.state.supabase) {
          // Only warn after some attempts to avoid noise during initial connection issues
          if (this.retryTimeout) {
            console.warn("[Realtime] Heartbeat: Connection lost or channel closed. Retrying...");
          } else {
            console.log("[Realtime] Heartbeat check - channel exists:", !!this.channel);
          }
          this.init(); // Attempt recovery
        }
      }, 60000);

    } catch (e) {
      console.error("[Realtime] Error during subscription setup:", e);
      this.isConnecting = false;
      if (!this.hasReportedError) {
        console.warn("[Realtime] Real-time initialization failed. Will retry later.");
      }
      this.hasReportedError = true;
      
      // Retry after a longer delay if there was an error
      this.retryTimeout = setTimeout(() => {
        this.retryTimeout = null;
        this.init();
      }, 30000);
    }
  }

  handleNewMessage(rawData) {
    const state = this.state;
    console.log("[Realtime] New message data arrived.");
    const message = this.normalize(rawData);
    
    if (!message.id) return;
    if (message.senderId === state.currentUser?.id) return;
    if (state.blockedUserIds?.includes(message.senderId)) return;
    if (state.bannedUserIds?.includes(message.senderId)) return;

    const normalizedId = String(message.id).trim().toLowerCase();

    // Prevent double processing (Broadcast + Postgres changes)
    if (this.processedMessageIds.has(normalizedId)) {
      console.log("[Realtime] Skipping already processed message:", normalizedId);
      return;
    }

    // Check the main notification system's seen set (safe check)
    const notificationsSeen = window.notifications?.hasSeenId && typeof window.notifications.hasSeenId === "function";
    if (notificationsSeen && window.notifications.hasSeenId(normalizedId)) {
      console.log("[Realtime] Skipping message already seen in notification system:", normalizedId);
      return;
    }

    this.processedMessageIds.add(normalizedId);
    if (this.processedMessageIds.size > 100) {
      const firstId = this.processedMessageIds.values().next().value;
      this.processedMessageIds.delete(firstId);
    }

    // Trigger sound (if not already handled by native push)
    const isActiveThread = message.threadId === state.activeThreadId && state.messengerOpen;
    const shouldChime = !isActiveThread || document.visibilityState === "hidden";
    
    try {
      if (shouldChime && window.playIncomingMessageSound) window.playIncomingMessageSound();
    } catch (e) {}

    // Show Notification
    const senderProfile = (state.availableProfiles || []).find(p => p.id === message.senderId);
    let senderName = senderProfile ? (senderProfile.displayName || "Member") : "Member";
    let messageBody = message.body || "Sent an attachment";
    
    if (state.preferences?.notificationHideSender) senderName = "Someone";
    if (state.preferences?.notificationHideBody) messageBody = "New message";

    console.log("[Realtime] Notification System Status:", window.notifications ? "Ready" : "Missing", 
                "Mobile:", typeof window.Capacitor?.getPlatform === 'function' && window.Capacitor.getPlatform() !== 'web');
    
    if (window.notifications && typeof window.notifications.add === "function") {
      // Show notification (Centralized system handles banners, history, and browser alerts)
      window.notifications.add({
        id: message.id,
        type: 'info',
        title: `${senderName} sent a message`,
        message: messageBody,
        read: isActiveThread,
        silent: isActiveThread,
        incrementCount: !isActiveThread,
        data: { type: "message", threadId: message.threadId }
      });
    }

    // Update UI
    if (message.threadId === state.activeThreadId && window.mergeActiveMessage) {
      console.log("[Realtime] Merging message into active thread.");
      window.mergeActiveMessage(message);
      if (window.renderActiveThread) window.renderActiveThread(true);
    } else if (window.refreshMessengerState) {
      console.log("[Realtime] Refreshing messenger state.");
      window.refreshMessengerState({ preserveActiveThread: true });
    }
  }
};
