/**
 * IMAP Service
 * Email receiving via IMAP protocol
 */

import Imap from "imap";
import { simpleParser } from "mailparser";

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
}

export interface MailMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: Date;
}

export interface FetchOptions {
  box?: string;
  limit?: number;
  unreadOnly?: boolean;
}

export class ImapService {
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
   * Fetch messages from IMAP server
   */
  async fetchMessages(
    config: ImapConfig,
    options: FetchOptions = {}
  ): Promise<MailMessage[]> {
    if (!this.validateConfig(config)) {
      throw new Error("Invalid IMAP config");
    }

    const { box = "INBOX", limit = 50, unreadOnly = false } = options;

    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user: config.user,
        password: config.password,
        host: config.host,
        port: config.port,
        tls: config.tls,
      });

      const messages: MailMessage[] = [];

      imap.once("ready", () => {
        imap.openBox(box, false, (err, mailbox) => {
          if (err) {
            imap.end();
            reject(err);
            return;
          }

          const total = mailbox.messages.total;
          if (total === 0) {
            imap.end();
            resolve([]);
            return;
          }

          const start = Math.max(1, total - limit + 1);
          const range = unreadOnly 
            ? `UNSEEN ${start}:*`
            : `${start}:*`;

          const fetch = imap.seq.fetch(range, {
            bodies: "",
            struct: true,
          });

          fetch.on("message", (msg) => {
            msg.on("body", (stream) => {
              simpleParser(stream).then((parsed) => {
                messages.push({
                  id: parsed.messageId || Date.now().toString(),
                  from: parsed.from?.value?.[0]?.text || "",
                  to: parsed.to?.value?.[0]?.text || "",
                  subject: parsed.subject || "",
                  body: parsed.text || "",
                  date: parsed.date || new Date(),
                });
              });
            });
          });

          fetch.once("error", (err) => {
            imap.end();
            reject(err);
          });

          fetch.once("end", () => {
            imap.end();
            resolve(messages);
          });
        });
      });

      imap.once("error", (err) => {
        reject(err);
      });

      imap.connect();
    });
  }

  /**
   * Verify IMAP connection
   */
  async verify(config: ImapConfig): Promise<boolean> {
    if (!this.validateConfig(config)) {
      return false;
    }

    return new Promise((resolve) => {
      const imap = new Imap({
        user: config.user,
        password: config.password,
        host: config.host,
        port: config.port,
        tls: config.tls,
      });

      imap.once("ready", () => {
        imap.end();
        resolve(true);
      });

      imap.once("error", () => {
        resolve(false);
      });

      imap.connect();
    });
  }
}
