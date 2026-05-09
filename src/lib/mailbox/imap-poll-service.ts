/**
 * IMAP Poll Service
 * Periodically polls IMAP server for new emails and delivers them to local mailboxes
 */

import Imap from "imap";
import { simpleParser } from "mailparser";
import { Database } from "../storage/database";
import { MessageStore } from "./message-store";
import { AddressManager } from "./address-manager";
import { EventBus, EventType } from "./event-bus";
import type { MailboxConfig } from "./config";

export interface ImapPollConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
  pollInterval: number;  // milliseconds
  localDomain: string;   // e.g., 'local' - addresses ending with @local are local
  onEmailReceived?: (email: ReceivedEmail) => void;
}

export interface ReceivedEmail {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: Date;
  messageId: string;  // IMAP message ID for tracking
}

export class ImapPollService {
  private imap?: Imap;
  private pollTimer?: ReturnType<typeof setInterval>;
  private lastUid: number = 0;
  private isConnected: boolean = false;
  
  constructor(
    private config: ImapPollConfig,
    private db: Database,
    private addressManager: AddressManager,
    private messageStore: MessageStore,
    private eventBus: EventBus
  ) {}

  /**
   * Start polling IMAP server
   */
  start(): void {
    if (this.pollTimer) {
      console.log("[ImapPollService] Already running");
      return;
    }

    console.log(`[ImapPollService] Starting with config:`);
    console.log(`  Host: ${this.config.host}`);
    console.log(`  User: ${this.config.user}`);
    console.log(`  Poll Interval: ${this.config.pollInterval}ms`);

    // Initial poll
    this.poll();

    // Schedule periodic polling
    this.pollTimer = setInterval(() => {
      this.poll();
    }, this.config.pollInterval);
  }

  /**
   * Stop polling
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
      console.log("[ImapPollService] Stopped polling");
    }

    if (this.imap) {
      this.imap.end();
      this.imap = undefined;
      this.isConnected = false;
    }
  }

  /**
   * Get connection status
   */
  getStatus(): { connected: boolean; lastUid: number } {
    return {
      connected: this.isConnected,
      lastUid: this.lastUid,
    };
  }

  /**
   * Manually trigger a poll
   */
  async poll(): Promise<void> {
    try {
      await this.fetchNewEmails();
    } catch (error) {
      console.error("[ImapPollService] Poll error:", error);
    }
  }

  /**
   * Fetch new emails from IMAP server
   */
  private async fetchNewEmails(): Promise<void> {
    // Close existing connection if any
    if (this.imap && this.isConnected) {
      try {
        this.imap.end();
      } catch (e) {
        // Ignore
      }
      this.imap = undefined;
      this.isConnected = false;
    }

    return new Promise((resolve, reject) => {
      this.imap = new Imap({
        user: this.config.user,
        password: this.config.password,
        host: this.config.host,
        port: this.config.port,
        tls: this.config.tls,
        connTimeout: 10000,
      });

      this.imap.once("ready", () => {
        this.isConnected = true;
        this.openInbox();
      });

      this.imap.once("error", (err) => {
        console.error("[ImapPollService] IMAP error:", err.message);
        this.isConnected = false;
        reject(err);
      });

      this.imap.once("close", () => {
        this.isConnected = false;
      });

      this.imap.connect();
    });
  }

  /**
   * Open INBOX and fetch new messages
   */
  private openInbox(): void {
    if (!this.imap) return;

    this.imap.openBox("INBOX", true, (err, box) => {
      if (err) {
        console.error("[ImapPollService] Failed to open INBOX:", err.message);
        this.imap?.end();
        return;
      }

      const total = box.messages.total;
      if (total === 0) {
        this.imap.end();
        return;
      }

      // Search for unseen messages with UID > lastUid
      if (this.lastUid > 0) {
        // Use UID range to get only new messages
        this.imap.search([["UID", `${this.lastUid + 1}:*`]], (searchErr, results) => {
          if (searchErr || !results || results.length === 0) {
            this.imap?.end();
            return;
          }

          // Fetch these messages
          const uids = results as number[];
          console.log(`[ImapPollService] Found ${uids.length} new message(s)`);
          
          this.fetchMessages(uids);
        });
      } else {
        // First run - get last N messages
        const limit = Math.min(total, 10);
        const start = total - limit + 1;
        
        this.imap.search([["UNSEEN"], ["UID", `${start}:${total}`]], (searchErr, results) => {
          if (searchErr || !results || results.length === 0) {
            this.imap?.end();
            return;
          }

          const uids = results as number[];
          console.log(`[ImapPollService] Initial fetch: ${uids.length} message(s)`);
          
          this.fetchMessages(uids);
        });
      }
    });
  }

  /**
   * Fetch specific messages by UID
   */
  private fetchMessages(uids: number[]): void {
    if (!this.imap || uids.length === 0) {
      this.imap?.end();
      return;
    }

    // Update lastUid to the highest UID
    this.lastUid = Math.max(...uids);

    const f = this.imap.fetch(uids, {
      bodies: "",
      struct: true,
    });

    let processedCount = 0;
    const totalToProcess = uids.length;

    f.on("message", (msg) => {
      let msgUid = 0;
      
      msg.on("uid", (uid) => {
        msgUid = uid;
      });

      msg.on("body", (stream) => {
        simpleParser(stream).then((parsed) => {
          const email: ReceivedEmail = {
            id: parsed.messageId || `imap-${msgUid}-${Date.now()}`,
            from: parsed.from?.value?.[0]?.address || parsed.from?.value?.[0]?.text || "",
            to: parsed.to?.value?.[0]?.address || parsed.to?.value?.[0]?.text || "",
            subject: parsed.subject || "",
            body: parsed.text || parsed.html?.replace(/<[^>]*>/g, "") || "",
            date: parsed.date || new Date(),
            messageId: msgUid.toString(),
          };

          this.processEmail(email);
          
          processedCount++;
          if (processedCount >= totalToProcess) {
            this.imap?.end();
          }
        }).catch((err) => {
          console.error("[ImapPollService] Parse error:", err);
          processedCount++;
          if (processedCount >= totalToProcess) {
            this.imap?.end();
          }
        });
      });
    });

    f.once("error", (err) => {
      console.error("[ImapPollService] Fetch error:", err);
      this.imap?.end();
    });
  }

  /**
   * Process received email - deliver to local mailbox and emit event
   */
  private processEmail(email: ReceivedEmail): void {
    console.log(`[ImapPollService] Processing email from ${email.from}: ${email.subject}`);

    // Check if destination is local address
    const isLocal = email.to.endsWith(`@${this.config.localDomain}`);
    
    if (!isLocal) {
      console.log(`[ImapPollService] Email to ${email.to} is not local, skipping`);
      return;
    }

    // Check if local address exists
    const address = this.addressManager.getByEmail(email.to);
    if (!address) {
      console.log(`[ImapPollService] Local address ${email.to} not found, skipping`);
      return;
    }

    // Store message locally
    const message = this.messageStore.send({
      fromAddress: email.from,
      toAddress: email.to,
      subject: email.subject,
      body: email.body,
    });

    console.log(`[ImapPollService] Message stored: ${message.id}`);

    // Emit received event
    this.eventBus.emit(EventType.MESSAGE_RECEIVED, {
      messageId: message.id,
      fromAddress: email.from,
      toAddress: email.to,
    });

    // Call optional callback
    if (this.config.onEmailReceived) {
      this.config.onEmailReceived(email);
    }
  }

  /**
   * Verify IMAP connection
   */
  async verifyConnection(): Promise<boolean> {
    return new Promise((resolve) => {
      const testImap = new Imap({
        user: this.config.user,
        password: this.config.password,
        host: this.config.host,
        port: this.config.port,
        tls: this.config.tls,
        connTimeout: 5000,
      });

      testImap.once("ready", () => {
        testImap.end();
        resolve(true);
      });

      testImap.once("error", () => {
        resolve(false);
      });

      testImap.connect();
    });
  }
}

/**
 * Default IMAP settings for 163.com
 */
export const DEFAULT_163_IMAP_CONFIG: Partial<ImapPollConfig> = {
  host: "imap.163.com",
  port: 993,
  tls: true,
  pollInterval: 30000,  // 30 seconds
};
