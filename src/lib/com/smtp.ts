/**
 * SMTP Service
 * Email sending via SMTP protocol
 */

import nodemailer from "nodemailer";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
}

export interface SendMailOptions {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export class SmtpService {
  /**
   * Validate SMTP configuration
   */
  validateConfig(config: Partial<SmtpConfig>): config is SmtpConfig {
    return !!(
      config.host &&
      config.port !== undefined &&
      config.port > 0 &&
      config.user &&
      config.password
    );
  }

  /**
   * Create nodemailer transporter
   */
  createTransporter(config: SmtpConfig): nodemailer.Transporter {
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.password,
      },
    });
  }

  /**
   * Send email via SMTP
   */
  async send(
    config: SmtpConfig,
    options: SendMailOptions
  ): Promise<SendResult> {
    if (!this.validateConfig(config)) {
      return { success: false, error: "Invalid SMTP config" };
    }

    const transporter = this.createTransporter(config);

    try {
      const info = await transporter.sendMail({
        from: options.from,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });

      return { success: true, messageId: info.messageId };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify SMTP connection
   */
  async verify(config: SmtpConfig): Promise<boolean> {
    if (!this.validateConfig(config)) {
      return false;
    }

    const transporter = this.createTransporter(config);

    try {
      await transporter.verify();
      return true;
    } catch (error) {
      return false;
    }
  }
}
