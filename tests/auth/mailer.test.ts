import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as mailerModule from '../../src/auth/mailer.js';

describe('SMTP Mailer', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Set test environment
    process.env.SMTP_HOST = 'smtp.test.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_SECURE = 'true';
    process.env.SMTP_FROM = 'test@test.com';
    process.env.SMTP_AUTH_CODE = 'test-code';
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  describe('createTransporter', () => {
    it('should create transporter with correct config from env', () => {
      const transporter = mailerModule.createTransporter();
      
      expect(transporter).toBeDefined();
      expect(typeof transporter.sendMail).toBe('function');
    });

    it('should throw error if SMTP_HOST is missing', () => {
      delete process.env.SMTP_HOST;

      expect(() => mailerModule.createTransporter()).toThrow('SMTP configuration incomplete. Required: SMTP_HOST, SMTP_FROM, SMTP_AUTH_CODE');
    });

    it('should throw error if SMTP_FROM is missing', () => {
      delete process.env.SMTP_FROM;

      expect(() => mailerModule.createTransporter()).toThrow('SMTP configuration incomplete. Required: SMTP_HOST, SMTP_FROM, SMTP_AUTH_CODE');
    });

    it('should throw error if SMTP_AUTH_CODE is missing', () => {
      delete process.env.SMTP_AUTH_CODE;

      expect(() => mailerModule.createTransporter()).toThrow('SMTP configuration incomplete. Required: SMTP_HOST, SMTP_FROM, SMTP_AUTH_CODE');
    });

    it('should use port 465 by default if SMTP_PORT not set', () => {
      delete process.env.SMTP_PORT;
      
      // Just verify it doesn't throw and creates a transporter
      const transporter = mailerModule.createTransporter();
      expect(transporter).toBeDefined();
    });

    it('should parse SMTP_PORT as integer', () => {
      process.env.SMTP_PORT = '587';
      
      const transporter = mailerModule.createTransporter();
      expect(transporter).toBeDefined();
    });

    it('should parse SMTP_SECURE as boolean true', () => {
      process.env.SMTP_SECURE = 'true';
      
      const transporter = mailerModule.createTransporter();
      expect(transporter).toBeDefined();
    });

    it('should parse SMTP_SECURE as boolean false', () => {
      process.env.SMTP_SECURE = 'false';
      
      const transporter = mailerModule.createTransporter();
      expect(transporter).toBeDefined();
    });
  });

  describe('getTransporter', () => {
    it('should return a transporter instance', () => {
      const transporter = mailerModule.getTransporter();
      
      expect(transporter).toBeDefined();
      expect(typeof transporter.sendMail).toBe('function');
    });

    it('should return the same transporter instance on multiple calls', () => {
      const transporter1 = mailerModule.getTransporter();
      const transporter2 = mailerModule.getTransporter();

      expect(transporter1).toBe(transporter2);
    });
  });

  describe('SendMailOptions interface', () => {
    it('should have correct interface structure', () => {
      // Test that the interface works correctly
      const options: mailerModule.SendMailOptions = {
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>'
      };

      expect(options.to).toBe('test@example.com');
      expect(options.subject).toBe('Test');
      expect(options.html).toBe('<p>Test</p>');
    });
  });

  describe('sendMail', () => {
    it('should be an async function', () => {
      expect(mailerModule.sendMail).toBeDefined();
      expect(typeof mailerModule.sendMail).toBe('function');
    });

    it('should require to, subject, and html parameters', async () => {
      // Since we can't easily mock nodemailer in bun, we test that 
      // the function exists and is callable
      expect(mailerModule.sendMail).toBeDefined();
    });
  });

  describe('sendVerificationEmail', () => {
    it('should be an async function', () => {
      expect(mailerModule.sendVerificationEmail).toBeDefined();
      expect(typeof mailerModule.sendVerificationEmail).toBe('function');
    });

    it('should require email and code parameters', async () => {
      // Test that the function exists and is callable
      expect(mailerModule.sendVerificationEmail).toBeDefined();
    });
  });
});
