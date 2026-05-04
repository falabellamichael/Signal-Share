/**
 * Messenger Realtime System (v2)
 * Dedicated file for live notifications and badge updates.
 */

window.MessengerRealtime = class MessengerRealtime {
  constructor(appState) {
    this.state = appState;
    this.channel = null;
    this.sessionHash = Math.random().toString(36).substring(2, 10);
    this.isConnecting = false;
    this.processedMessageIds = new Set(); // Prevent double-counting messages in same session
  }

  init() {
    if (!this.state.supabase || !this.state.currentUser || this.isConnecting) return;
    this.isConnecting = true;
    this.stop(); 
    
    // Tiny delay to ensure client readiness
    setTimeout(() => {
      const userId = this.state.currentUser.id;
      const channelName = `messenger_live_${userId.slice(0, 8)}`; 
      
      console.log("[Realtime] Connecting to hardened channel:", channelName);
      
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
          this.isConnecting = false;
          if (status === "SUBSCRIBED") {
            console.log("[Realtime] Connected.");
          }
          if (err || status === "CHANNEL_ERROR") {
            console.error("[Realtime] Transport issue. Retrying...", err);
            setTimeout(() => this.init(), 5000);
          }
        });
    }, 1000);

    // Heartbeat to monitor health
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      console.log("[Realtime] Heartbeat. Status:", this.channel ? "Connected" : "Disconnected");
    }, 30000);
  }

  handleNewMessage(rawData) {
    const state = this.state;
    console.log("[Realtime] New message data arrived.");
    const message = this.normalize(rawData);
    
    if (message.senderId === state.currentUser?.id) return;
    if (state.blockedUserIds?.includes(message.senderId)) return;
    if (state.bannedUserIds?.includes(message.senderId)) return;
    
    // Prevent double processing (Broadcast + Postgres changes)
    if (this.processedMessageIds.has(message.id)) {
      console.log("[Realtime] Skipping already processed message:", message.id);
      return;
    }
    this.processedMessageIds.add(message.id);
    if (this.processedMessageIds.size > 100) {
      // Keep set size reasonable
      const firstId = this.processedMessageIds.values().next().value;
      this.processedMessageIds.delete(firstId);
    }

    // Trigger sound
    try {
      if (window.playIncomingMessageSound) window.playIncomingMessageSound();
    } catch (e) {}

    // Show Notification
    const senderProfile = (state.availableProfiles || []).find(p => p.id === message.senderId);
    let senderName = senderProfile ? (senderProfile.displayName || "Member") : "Member";
    let messageBody = message.body || "Sent an attachment";
    
    if (state.preferences?.notificationHideSender) senderName = "Someone";
    if (state.preferences?.notificationHideBody) messageBody = "New message";

    // 1. Try main notification system
    const isMobile = !!window.Capacitor && window.Capacitor.getPlatform() !== "web";
    console.log("[Realtime] Notification System Status:", window.notifications ? "Ready" : "Missing", "Mobile:", isMobile);
    
    if (window.notifications && typeof window.notifications.info === "function") {
      // Only show text banners on PC, hide on mobile to save screen space
      const added = window.notifications.info(messageBody, `${senderName} sent a message`, { id: message.id });

      const isActiveThread = message.threadId === state.activeThreadId;
      if (added && (!state.messengerOpen || !isActiveThread)) {
        console.log("[Realtime] Incrementing unread count via main system.");
        window.notifications.incrementUnreadCount();
      }
    } else {
      console.log("[Realtime] Using Fallback Badge Logic.");
      // 2. Fallback: Direct DOM update for mobile stability
      const isActiveThread = message.threadId === state.activeThreadId;
      if (!state.messengerOpen || !isActiveThread) {
        this.fallbackIncrementBadge();
      }
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

  fallbackIncrementBadge() {
    try {
      let count = parseInt(localStorage.getItem("signal_share_unread_count") || "0", 10);
      count++;
      localStorage.setItem("signal_share_unread_count", count.toString());
      
      const badge = document.getElementById("notificationBadge");
      if (badge) {
        badge.textContent = count.toString();
        badge.style.setProperty("display", "flex", "important");
        badge.style.setProperty("opacity", "1", "important");
        badge.style.setProperty("visibility", "visible", "important");
      }
      console.log("[Realtime] Fallback badge update:", count);
    } catch (e) {
      console.error("[Realtime] Fallback badge failed:", e);
    }
  }

  stop() {
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
