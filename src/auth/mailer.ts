/**
 * SMTP Mailer for Bounty Platform
 * 
 * This module provides email sending functionality using nodemailer.
 * Configure SMTP via environment variables.
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

/**
 * Create a nodemailer transporter from environment configuration
 * 
 * Required environment variables:
 * - SMTP_HOST: SMTP server host
 * - SMTP_FROM: Sender email address
 * - SMTP_AUTH_CODE: SMTP authentication code/password
 * 
 * Optional environment variables:
 * - SMTP_PORT: SMTP port (default: 465)
 * - SMTP_SECURE: Use SSL/TLS (default: true for port 465)
 * 
 * @returns Configured nodemailer transporter
 * @throws Error if required SMTP configuration is missing
 */
export function createTransporter(): Transporter {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_FROM;
  const pass = process.env.SMTP_AUTH_CODE;
  
  if (!host || !user || !pass) {
    throw new Error('SMTP configuration incomplete. Required: SMTP_HOST, SMTP_FROM, SMTP_AUTH_CODE');
  }
  
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass
    }
  });
}

/**
 * Get the singleton transporter instance
 * Creates transporter on first call, reuses on subsequent calls
 * 
 * @returns The nodemailer transporter
 */
export function getTransporter(): Transporter {
  if (!transporter) {
    transporter = createTransporter();
  }
  return transporter;
}

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
}

/**
 * Send an HTML email
 * 
 * @param options - Email options (to, subject, html)
 */
export async function sendMail(options: SendMailOptions): Promise<void> {
  const mailer = getTransporter();
  const from = process.env.SMTP_FROM || 'noreply@bounty.local';
  
  await mailer.sendMail({
    from: `"Bounty Platform" <${from}>`,
    to: options.to,
    subject: options.subject,
    html: options.html
  });
}

/**
 * Send a verification email with a 6-digit code
 * 
 * @param email - Recipient email address
 * @param code - 6-digit verification code
 * @param agentName - Optional agent name for personalization
 */
export async function sendVerificationEmail(email: string, code: string, agentName?: string): Promise<void> {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Bounty Platform 邮箱验证</h2>
      <p>您好${agentName ? `, ${agentName}` : ''}，</p>
      <p>您的验证码是：</p>
      <div style="background: #f5f5f5; padding: 20px; text-align: center; font-size: 32px; letter-spacing: 8px; margin: 20px 0;">
        <strong>${code}</strong>
      </div>
      <p style="color: #666; font-size: 14px;">验证码有效期为 24 小时，请尽快完成验证。</p>
      <p style="color: #999; font-size: 12px;">如果你没有请求此验证码，请忽略此邮件。</p>
    </div>
  `;
  
  await sendMail({
    to: email,
    subject: 'Bounty Platform 邮箱验证码',
    html
  });
}
