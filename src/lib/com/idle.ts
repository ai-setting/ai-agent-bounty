/**
 * IMAP IDLE Service
 * Real-time email notification via IMAP IDLE
 */

import Imap from "imap";
import { simpleParser } from "mailparser";
import { ImapConfig, MailMessage } from "./imap.js";

export type NewMailCallback = (message: MailMessage) => void;

export class IdleService {
  private imap?: Imap;
  private running: boolean = false;
  private lastUid: number = 0;
  private reconnectTimeout?: ReturnType<typeof setTimeout>;

  /**
   * Validate IMAP configuration
   */
  validateConfig(config: Partial<ImapConfig>): config is ImapConfig {
    return !!(
      config.host &&
      config.port !== undefined &&
      config.port > 0 &&
      config.user &&
      config.password
    );
  }

  /**
   * Start IDLE monitoring
   */
  async start(config: ImapConfig, onNewMail: NewMailCallback): Promise<void> {
    if (!this.validateConfig(config)) {
      throw new Error("Invalid IMAP config");
    }

    if (this.running) {
      console.warn("[IdleService] Already running");
      return;
    }

    this.running = true;
    this.imap = new Imap({
      user: config.user,
      password: config.password,
      host: config.host,
      port: config.port,
      tls: config.tls,
      keepalive: {
        interval: 30000,
        idleInterval: 1800000,
      },
    });

    this.setupListeners(config, onNewMail);
  }

  private setupListeners(config: ImapConfig, onNewMail: NewMailCallback): void {
    if (!this.imap) return;

    this.imap.on("ready", () => {
      console.log("[IdleService] IMAP connected");
      
      this.imap!.openBox("INBOX", false, (err) => {
        if (err) {
          console.error("[IdleService] Failed to open INBOX:", err);
          this.scheduleReconnect(config, onNewMail);
          return;
        }
        this.idle(config, onNewMail);
      });
    });

    this.imap.on("mail", (count: number) => {
      console.log(`[IdleService] New mail detected: ${count} message(s)`);
      this.fetchNewMessages(config, onNewMail);
    });

    this.imap.on("error", (err: Error) => {
      console.error("[IdleService] IMAP error:", err.message);
      this.scheduleReconnect(config, onNewMail);
    });

    this.imap.on("close", () => {
      if (this.running) {
        this.scheduleReconnect(config, onNewMail);
      }
    });

    this.imap.connect();
  }

  private idle(config: ImapConfig, onNewMail: NewMailCallback): void {
    if (!this.imap || !this.running) return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.imap as any).idle((err: Error | null) => {
        if (err) {
          console.error("[IdleService] IDLE error:", err.message);
          this.scheduleReconnect(config, onNewMail);
          return;
        }

        // Re-enter IDLE after 30 minutes to prevent server timeout
        setTimeout(() => {
          if (this.running && this.imap) {
            this.idle(config, onNewMail);
          }
        }, 30 * 60 * 1000);
      });
    } catch (err) {
      console.error("[IdleService] IDLE exception:", err);
      this.scheduleReconnect(config, onNewMail);
    }
  }

  private async fetchNewMessages(config: ImapConfig, onNewMail: NewMailCallback): Promise<void> {
    if (!this.imap || !this.running) return;

    try {
      const box = await new Promise<any>((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.imap as any).getBox((err: Error | null, data: any) => {
          if (err) reject(err);
          else resolve(data);
        });
      });

      if (box.messages.total === 0) return;

      const startUid = this.lastUid + 1;
      const fetch = this.imap.seq.fetch(`${startUid}:*`, {
        bodies: "",
        struct: true,
      });

      fetch.on("message", (msg: any) => {
        msg.on("body", (stream: any) => {
          simpleParser(stream).then((parsed: any) => {
            const message: MailMessage = {
              id: parsed.messageId || Date.now().toString(),
              from: parsed.from?.value?.[0]?.text || "",
              to: parsed.to?.value?.[0]?.text || "",
              subject: parsed.subject || "",
              body: parsed.text || "",
              date: parsed.date || new Date(),
            };
            onNewMail(message);
            this.lastUid = Math.max(this.lastUid, startUid);
          });
        });
      });

      fetch.once("error", (err: Error) => {
        console.error("[IdleService] Fetch error:", err.message);
      });
    } catch (err) {
      console.error("[IdleService] Failed to fetch new messages:", err);
    }
  }

  private scheduleReconnect(config: ImapConfig, onNewMail: NewMailCallback): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectTimeout = setTimeout(() => {
      if (this.running) {
        console.log("[IdleService] Reconnecting...");
        this.stop().then(() => {
          this.start(config, onNewMail);
        });
      }
    }, 5000);
  }

  /**
   * Stop IDLE monitoring
   */
  async stop(): Promise<void> {
    this.running = false;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }

    if (this.imap) {
      this.imap.end();
      this.imap = undefined;
    }

    console.log("[IdleService] Stopped");
  }

  /**
   * Check if service is running
   */
  isRunning(): boolean {
    return this.running;
  }
}
