/**
 * Messenger Realtime System (v2)
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
  }

  init() {
    if (!this.state.supabase || !this.state.currentUser || this.isConnecting || this.channel) return;
    this.isConnecting = true;
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }

    this.stop();
    this.isConnecting = true;

    const userId = this.state.currentUser.id;
    const channelName = `messenger_live_${userId.slice(0, 8)}`; 
    
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
          this.isConnecting = false;
          this.hasReportedError = false;
          if (this.lastStatus !== "SUBSCRIBED") {
            console.log("[Realtime] Connected.");
            this.lastStatus = "SUBSCRIBED";
          }
          return;
        }
        
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED" || err) {
          this.isConnecting = false;
          
          if (!this.hasReportedError) {
            console.error("[Realtime] Transport issue. Retrying in background...", err || status);
            this.hasReportedError = true;
          }
          
          this.lastStatus = status;

          if (!this.retryTimeout) {
            this.retryTimeout = setTimeout(() => {
              this.retryTimeout = null;
              this.init();
            }, 10000); // Slower retry for stability
          }
        }
      }, 20000);

    // Silent heartbeat
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      // Only log if connection is actually lost to keep console clean
      if (!this.channel) {
         console.warn("[Realtime] Heartbeat: Disconnected. Attempting recovery...");
         this.init();
      }
    }, 60000);
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

    // Also check the main notification system's seen set
    if (window.notifications && typeof window.notifications.hasSeenId === "function") {
      if (window.notifications.hasSeenId(normalizedId)) {
        console.log("[Realtime] Skipping message already seen in notification system:", normalizedId);
        return;
      }
    }

    this.processedMessageIds.add(normalizedId);
    if (this.processedMessageIds.size > 100) {
      const firstId = this.processedMessageIds.values().next().value;
      this.processedMessageIds.delete(firstId);
    }

    // Trigger sound (if not already handled by native push)
    // We skip the chime if the user is actively viewing this specific thread.
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

    // 1. Try main notification system
    const isMobile = !!window.Capacitor && window.Capacitor.getPlatform() !== "web";

    console.log("[Realtime] Notification System Status:", window.notifications ? "Ready" : "Missing", "Mobile:", isMobile, "Active:", isActiveThread);
    
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
    } else {
      console.warn("[Realtime] Notification system not yet initialized or missing 'add' method.");
    }

    // 3. Update UI
    if (message.threadId === state.activeThreadId && window.mergeActiveMessage) {
      console.log("[Realtime] Merging message into active thread.");
      window.mergeActiveMessage(message);
      if (window.renderActiveThread) window.renderActiveThread(true);
    } else if (window.refreshMessengerState) {
      console.log("[Realtime] Refreshing messenger state.");
      window.refreshMessengerState({ preserveActiveThread: true });
    } else {
      console.warn("[Realtime] refreshMessengerState MISSING from window.");
    }
  }

  stop() {
    this.isConnecting = false;
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.channel) {
      console.log("[Realtime] Stopping and removing channel...");
      this.channel.unsubscribe();
      if (this.state.supabase) {
        this.state.supabase.removeChannel(this.channel);
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
      attachmentUrl: row.attachment_file_path
    };
  }
};
