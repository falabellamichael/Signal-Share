/**
 * Messenger Realtime System (v2)
 * Dedicated file for live notifications and badge updates.
 */

window.MessengerRealtime = class MessengerRealtime {
  constructor(appState) {
    this.state = appState;
    this.channel = null;
    this.sessionHash = Math.random().toString(36).substring(2, 10);
  }

  init() {
    if (!this.state.supabase || !this.state.currentUser) return;
    this.stop(); 
    const userId = this.state.currentUser.id;
    const channelName = `messenger_live_${userId.slice(0, 8)}`;
    
    console.log("[Realtime] Connecting to:", channelName);
    
    this.channel = this.state.supabase.channel(channelName, {
      config: { broadcast: { self: false, ack: true } }
    })
      .on("postgres_changes", { 
        event: "INSERT", 
        schema: "public", 
        table: "messages" 
      }, (payload) => {
        this.handleNewMessage(payload.new);
      })
      .on("broadcast", { event: "new-message" }, (payload) => {
        console.log("[Realtime] Instant Broadcast received:", payload);
        this.handleNewMessage(payload.payload);
      })
      .subscribe((status, err) => {
        console.log("[Realtime] Status:", status);
        if (err || status === "CHANNEL_ERROR") {
          console.error("[Realtime] Connection issue. Retrying in 3s...", err);
          setTimeout(() => this.init(), 3000);
        }
      });
  }

  handleNewMessage(rawData) {
    const state = this.state;
    console.log("[Realtime] New message data arrived.");
    const message = this.normalize(rawData);
    
    if (message.senderId === state.currentUser?.id) return;
    if (state.blockedUserIds?.includes(message.senderId)) return;
    if (state.bannedUserIds?.includes(message.senderId)) return;

    // Trigger sound
    try {
      if (window.playIncomingMessageSound) window.playIncomingMessageSound();
    } catch (e) {}

    // Show Notification
    if (window.notifications) {
      const senderProfile = (state.availableProfiles || []).find(p => p.id === message.senderId);
      let senderName = senderProfile ? (senderProfile.displayName || "Member") : "Member";
      let messageBody = message.body || "Sent an attachment";
      
      if (state.preferences?.notificationHideSender) senderName = "Someone";
      if (state.preferences?.notificationHideBody) messageBody = "New message";

      window.notifications.info(messageBody, `${senderName} sent a message`);
      
      const isActiveThread = message.threadId === state.activeThreadId;
      if (!state.messengerOpen || !isActiveThread) {
        window.notifications.incrementUnreadCount();
      }
    }

    // Update UI
    if (message.threadId === state.activeThreadId && window.mergeActiveMessage) {
      window.mergeActiveMessage(message);
      if (window.renderActiveThread) window.renderActiveThread(true);
    } else if (window.refreshMessengerState) {
      window.refreshMessengerState({ preserveActiveThread: true });
    }
  }

  stop() {
    if (this.channel) {
      this.channel.unsubscribe();
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
