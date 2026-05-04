/**
 * Messenger Realtime System (v1)
 * Handles live message notifications and badge updates.
 */

export class MessengerRealtime {
  constructor(appState) {
    this.state = appState;
    this.channel = null;
    this.sessionHash = Math.random().toString(36).substring(2, 10);
  }

  /**
   * Starts listening for new messages
   */
  init() {
    if (!this.state.supabase || !this.state.currentUser) return;
    
    this.stop(); // Clean up any old connections
    
    const userId = this.state.currentUser.id;
    // Simplified, rock-solid naming convention
    const channelName = `messenger_live_${userId.slice(0, 8)}`;
    
    console.log("[Realtime] Connecting to:", channelName);
    
    this.channel = this.state.supabase.channel(channelName)
      .on("postgres_changes", { 
        event: "INSERT", 
        schema: "public", 
        table: "messages" 
      }, (payload) => {
        this.handleNewMessage(payload.new);
      })
      .subscribe((status, err) => {
        console.log("[Realtime] Status:", status);
        if (err || status === "CHANNEL_ERROR") {
          console.error("[Realtime] Error encountered. Retrying in 3s...", err);
          setTimeout(() => this.init(), 3000);
        }
      });
  }

  /**
   * Processes an incoming message and triggers alerts
   */
  handleNewMessage(rawData) {
    const state = this.state;
    // 1. Normalize the data
    const message = this.normalize(rawData);
    
    // 2. Ignore if it's from us or from someone we blocked
    if (message.senderId === state.currentUser?.id) return;
    if (state.blockedUserIds?.includes(message.senderId)) return;
    if (state.bannedUserIds?.includes(message.senderId)) return;

    console.log("[Realtime] New message detected from:", message.senderId);

    // 3. Play sound (always)
    if (window.playIncomingMessageSound) {
      window.playIncomingMessageSound();
    }

    // 4. Update Notification System
    if (window.notifications) {
      const senderProfile = (state.availableProfiles || []).find(p => p.id === message.senderId);
      let senderName = senderProfile ? (senderProfile.displayName || "Member") : "Member";
      let messageBody = message.body || "Sent an attachment";
      
      // Respect privacy settings
      if (state.preferences?.notificationHideSender) senderName = "Someone";
      if (state.preferences?.notificationHideBody) messageBody = "New message";

      // Show banner
      window.notifications.info(messageBody, `${senderName} sent a message`);
      
      // Increment badge if messenger is closed or we aren't in that thread
      const isActiveThread = message.threadId === state.activeThreadId;
      if (!state.messengerOpen || !isActiveThread) {
        window.notifications.incrementUnreadCount();
      }
    }

    // 5. Update UI if messenger is open
    if (message.threadId === state.activeThreadId && window.mergeActiveMessage) {
      window.mergeActiveMessage(message);
      if (window.renderActiveThread) {
        window.renderActiveThread(true);
      }
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
}
