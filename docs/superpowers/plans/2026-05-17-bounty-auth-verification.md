# Bounty Auth & Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement email verification for agent registration, OAuth Bearer Token authentication, and dynamic domain configuration for Bounty Platform.

**Architecture:** Add new auth module with JWT tokens, integrate SMTP for verification emails, refactor existing APIs to require Bearer Token authentication, and use environment variables for domain configuration.

**Tech Stack:** TypeScript, Node.js, JWT (jose), nodemailer, SQLite

---

## File Structure

```
src/
├── auth/                          # NEW: Auth module
│   ├── index.ts                   # Auth exports
│   ├── routes.ts                  # Auth API routes
│   ├── middleware.ts              # JWT verification middleware
│   ├── service.ts                 # Auth business logic
│   ├── jwt.ts                     # JWT utilities
│   ├── mailer.ts                  # SMTP mailer
│   ├── verification.ts            # Verification code logic
│   └── types.ts                   # Auth types
├── lib/
│   ├── storage/
│   │   └── database.ts            # MODIFY: Add verifications table, new columns
│   ├── agent/
│   │   ├── index.ts               # MODIFY: Add address field, new methods
│   │   └── service.ts             # MODIFY: Update create logic
│   └── bounty/
│       ├── index.ts               # MODIFY: Export types
│       └── service.ts             # MODIFY: Add agent_id lookup
├── im/
│   ├── server/
│   │   ├── index.ts              # MODIFY: Add auth middleware to routes
│   │   ├── http.ts               # MODIFY: Add auth routes, protect business APIs
│   │   └── ws.ts                 # MODIFY: Add token auth for WebSocket
│   └── db/
│       └── index.ts               # MODIFY: Add address field
└── bin/
    └── bounty.ts                  # MODIFY: Load env config

.env.example                       # NEW: Environment template
tests/
├── auth/
│   ├── auth.test.ts              # NEW: Auth API tests
│   ├── verification.test.ts      # NEW: Verification logic tests
│   └── jwt.test.ts               # NEW: JWT tests
└── setup.ts                      # NEW: Test setup
```

---

## Implementation Tasks

### Task 1: Database Schema Update

**Files:**
- Modify: `src/lib/storage/database.ts`
- Test: `tests/db/schema.test.ts` (new)

- [ ] **Step 1: Add schema migration code**

```typescript
// In database.ts, add migration function
async function runMigrations(db: Database) {
  // Add status column to agents if not exists
  await db.exec(`
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'
  `);
  
  // Add address column to agents if not exists  
  await db.exec(`
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS address TEXT
  `);
  
  // Create verifications table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS verifications (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      type TEXT DEFAULT 'register',
      expires_at INTEGER NOT NULL,
      verified_at INTEGER,
      created_at INTEGER NOT NULL
    )
  `);
  
  // Create index for email lookup
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_verifications_email ON verifications(email)
  `);
}
```

- [ ] **Step 2: Write migration test**

```typescript
// tests/db/schema.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/lib/storage/database.js';

describe('Database Migrations', () => {
  let db: Database.Database;
  
  beforeEach(() => {
    db = new Database(':memory:');
  });
  
  it('should add status column to agents', async () => {
    await runMigrations(db);
    const result = db.prepare("PRAGMA table_info(agents)").all();
    const statusCol = result.find(col => col.name === 'status');
    expect(statusCol).toBeDefined();
    expect(statusCol.dflt_value).toBe('pending');
  });
  
  it('should add address column to agents', async () => {
    await runMigrations(db);
    const result = db.prepare("PRAGMA table_info(agents)").all();
    const addressCol = result.find(col => col.name === 'address');
    expect(addressCol).toBeDefined();
  });
  
  it('should create verifications table', async () => {
    await runMigrations(db);
    const result = db.prepare("PRAGMA table_info(verifications)").all();
    expect(result.length).toBeGreaterThan(0);
    expect(result.find(col => col.name === 'email')).toBeDefined();
    expect(result.find(col => col.name === 'code')).toBeDefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/db/schema.test.ts`
Expected: FAIL (files don't exist)

- [ ] **Step 4: Create test directory and file**

Create directory structure and save test file

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/db/schema.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/storage/database.ts tests/db/schema.test.ts
git commit -m "feat: add database migrations for auth schema"
```

---

### Task 2: Auth Types Definition

**Files:**
- Create: `src/auth/types.ts`
- Test: `tests/auth/types.test.ts` (new)

- [ ] **Step 1: Write types test**

```typescript
// tests/auth/types.test.ts
import { describe, it, expect } from 'vitest';
import type {
  AuthTokenPayload,
  RegisterInput,
  VerificationRequest,
  VerifyInput,
  LoginInput
} from '../../src/auth/types.js';

describe('Auth Types', () => {
  it('AuthTokenPayload should have required fields', () => {
    const payload: AuthTokenPayload = {
      sub: 'agent-123',
      email: 'test@example.com',
      iat: Date.now(),
      exp: Date.now() + 86400000
    };
    expect(payload.sub).toBeDefined();
    expect(payload.email).toBeDefined();
  });
  
  it('RegisterInput should validate email format', () => {
    const input: RegisterInput = {
      email: 'valid@email.com',
      name: 'Test Agent',
      description: 'A test agent'
    };
    expect(input.email).toMatch(/^[\w.-]+@[\w.-]+\.\w+$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/auth/types.test.ts`
Expected: FAIL (types not defined)

- [ ] **Step 3: Write types**

```typescript
// src/auth/types.ts
export interface AuthTokenPayload {
  sub: string;        // agent_id
  email: string;
  iat: number;
  exp: number;
}

export interface RegisterInput {
  email: string;
  name: string;
  description?: string;
}

export interface SendCodeInput {
  email: string;
}

export interface VerifyInput {
  email: string;
  code: string;
}

export interface LoginInput {
  email?: string;
  agent_id?: string;
}

export interface AuthResponse {
  token: string;
  expires_in: number;
  agent_id: string;
  email: string;
  address?: string;
}

export interface RegisterResponse {
  agent_id: string;
  status: 'pending';
  message: string;
}

export interface VerifyResponse {
  agent_id: string;
  status: 'active';
  address: string;
  token: string;
  credits: number;
}

export interface AgentProfile {
  id: string;
  name: string;
  email: string;
  address?: string;
  description?: string;
  credits: number;
  status: string;
  created_at: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/auth/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/types.ts tests/auth/types.test.ts
git commit -m "feat: add auth types"
```

---

### Task 3: JWT Utilities

**Files:**
- Create: `src/auth/jwt.ts`
- Test: `tests/auth/jwt.test.ts` (new)

- [ ] **Step 1: Write JWT tests**

```typescript
// tests/auth/jwt.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT, jwtVerify } from 'jose';

const TEST_SECRET = new TextEncoder().encode('test-secret-key');

describe('JWT Utilities', () => {
  it('should create a valid JWT token', async () => {
    const token = await new SignJWT({ sub: 'agent-123', email: 'test@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(TEST_SECRET);
    
    expect(token).toBeDefined();
    expect(token.split('.').length).toBe(3);
  });
  
  it('should verify a valid JWT token', async () => {
    const token = await new SignJWT({ sub: 'agent-123', email: 'test@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(TEST_SECRET);
    
    const { payload } = await jwtVerify(token, TEST_SECRET);
    expect(payload.sub).toBe('agent-123');
    expect(payload.email).toBe('test@example.com');
  });
  
  it('should reject expired token', async () => {
    const token = await new SignJWT({ sub: 'agent-123' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('-1h')  // Already expired
      .sign(TEST_SECRET);
    
    await expect(jwtVerify(token, TEST_SECRET)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/auth/jwt.test.ts`
Expected: FAIL (jose not installed, module not found)

- [ ] **Step 3: Install jose**

Run: `bun add jose`
Expected: Package installed

- [ ] **Step 4: Write JWT module**

```typescript
// src/auth/jwt.ts
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { AuthTokenPayload } from './types.js';

const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return new TextEncoder().encode(secret);
};

export async function createToken(payload: Omit<AuthTokenPayload, 'iat' | 'exp'>): Promise<string> {
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(getSecret());
  
  return token;
}

export async function verifyToken(token: string): Promise<AuthTokenPayload> {
  const { payload } = await jwtVerify(token, getSecret());
  return payload as unknown as AuthTokenPayload;
}

export function getTokenExpiry(): number {
  return 24 * 60 * 60; // 24 hours in seconds
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/auth/jwt.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/auth/jwt.ts tests/auth/jwt.test.ts
git add jose to package.json
git commit -m "feat: add JWT utilities"
```

---

### Task 4: SMTP Mailer

**Files:**
- Create: `src/auth/mailer.ts`
- Test: `tests/auth/mailer.test.ts` (new)

- [ ] **Step 1: Write mailer tests**

```typescript
// tests/auth/mailer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import nodemailer from 'nodemailer';

vi.mock('nodemailer');

describe('SMTP Mailer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  it('should create transporter with env config', () => {
    process.env.SMTP_HOST = 'smtp.163.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_SECURE = 'true';
    process.env.SMTP_FROM = 'test@163.com';
    process.env.SMTP_AUTH_CODE = 'test-code';
    
    // Import after setting env
    const { createTransporter } = require('../../src/auth/mailer.js');
    const transporter = createTransporter();
    
    expect(transporter).toBeDefined();
  });
  
  it('should throw error if SMTP config missing', () => {
    delete process.env.SMTP_FROM;
    
    expect(() => {
      const { createTransporter } = require('../../src/auth/mailer.js');
      createTransporter();
    }).toThrow('SMTP_FROM');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/auth/mailer.test.ts`
Expected: FAIL

- [ ] **Step 3: Install nodemailer**

Run: `bun add nodemailer @types/nodemailer`
Expected: Packages installed

- [ ] **Step 4: Write mailer module**

```typescript
// src/auth/mailer.ts
import nodemailer, { type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/auth/mailer.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/auth/mailer.ts tests/auth/mailer.test.ts
git commit -m "feat: add SMTP mailer"
```

---

### Task 5: Verification Code Logic

**Files:**
- Create: `src/auth/verification.ts`
- Test: `tests/auth/verification.test.ts` (new)

- [ ] **Step 1: Write verification tests**

```typescript
// tests/auth/verification.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';

describe('Verification Logic', () => {
  let mockDb: any;
  
  beforeEach(() => {
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(null),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      })
    };
  });
  
  it('should generate 6-digit code', () => {
    const { generateCode } = require('../../src/auth/verification.js');
    const code = generateCode();
    expect(code).toMatch(/^\d{6}$/);
  });
  
  it('should generate unique codes', () => {
    const { generateCode } = require('../../src/auth/verification.js');
    const codes = new Set();
    for (let i = 0; i < 100; i++) {
      codes.add(generateCode());
    }
    expect(codes.size).toBe(100);
  });
  
  it('should check rate limit correctly', () => {
    const { checkRateLimit } = require('../../src/auth/verification.js');
    
    // No previous code - should pass
    const result1 = checkRateLimit(mockDb, 'test@example.com');
    expect(result1.allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/auth/verification.test.ts`
Expected: FAIL

- [ ] **Step 3: Write verification module**

```typescript
// src/auth/verification.ts
import { randomBytes } from 'crypto';
import type Database from 'better-sqlite3';
import { generateUUID } from '../lib/utils.js';

const CODE_LENGTH = 6;
const CODE_EXPIRY_HOURS = 24;
const RATE_LIMIT_SECONDS = 60;

export function generateCode(): string {
  const buffer = randomBytes(3);  // 3 bytes = 24 bits = ~6 decimal digits
  const num = buffer.readUInt16BE(0) % 1000000;
  return num.toString().padStart(6, '0');
}

export interface RateLimitResult {
  allowed: boolean;
  waitSeconds?: number;
}

export function checkRateLimit(db: Database.Database, email: string): RateLimitResult {
  const recent = db.prepare(`
    SELECT created_at FROM verifications 
    WHERE email = ? AND type = 'register'
    ORDER BY created_at DESC LIMIT 1
  `).get(email) as { created_at: number } | undefined;
  
  if (recent) {
    const elapsed = Math.floor(Date.now() / 1000) - Math.floor(recent.created_at / 1000);
    if (elapsed < RATE_LIMIT_SECONDS) {
      return {
        allowed: false,
        waitSeconds: RATE_LIMIT_SECONDS - elapsed
      };
    }
  }
  
  return { allowed: true };
}

export function createVerification(db: Database.Database, agentId: string, email: string, code: string): void {
  const id = generateUUID();
  const now = Date.now();
  const expiresAt = now + (CODE_EXPIRY_HOURS * 60 * 60 * 1000);
  
  db.prepare(`
    INSERT INTO verifications (id, agent_id, email, code, type, expires_at, created_at)
    VALUES (?, ?, ?, ?, 'register', ?, ?)
  `).run(id, agentId, email, code, expiresAt, now);
}

export interface VerificationResult {
  valid: boolean;
  error?: string;
  agentId?: string;
}

export function verifyCode(db: Database.Database, email: string, code: string): VerificationResult {
  const record = db.prepare(`
    SELECT * FROM verifications 
    WHERE email = ? AND code = ? AND type = 'register' AND verified_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `).get(email, code) as any;
  
  if (!record) {
    return { valid: false, error: 'Invalid or expired verification code' };
  }
  
  const now = Date.now();
  if (now > record.expires_at) {
    return { valid: false, error: 'Verification code has expired' };
  }
  
  // Mark as verified
  db.prepare(`
    UPDATE verifications SET verified_at = ? WHERE id = ?
  `).run(now, record.id);
  
  return { valid: true, agentId: record.agent_id };
}

export function getLatestVerification(db: Database.Database, email: string) {
  return db.prepare(`
    SELECT * FROM verifications 
    WHERE email = ? AND type = 'register'
    ORDER BY created_at DESC LIMIT 1
  `).get(email) as any;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/auth/verification.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/verification.ts tests/auth/verification.test.ts
git commit -m "feat: add verification code logic"
```

---

### Task 6: Auth Service

**Files:**
- Create: `src/auth/service.ts`
- Test: `tests/auth/service.test.ts` (new)

- [ ] **Step 1: Write auth service tests**

```typescript
// tests/auth/service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';

describe('Auth Service', () => {
  let mockDb: any;
  let mockMailer: any;
  
  beforeEach(() => {
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(null),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      })
    };
    
    mockMailer = {
      sendVerificationEmail: vi.fn().mockResolvedValue(undefined)
    };
    
    vi.mock('../../src/auth/mailer.js', () => mockMailer);
  });
  
  it('should register new agent with pending status', async () => {
    const { register } = require('../../src/auth/service.js');
    
    const result = await register(mockDb, {
      email: 'test@example.com',
      name: 'Test Agent',
      description: 'A test'
    });
    
    expect(result.agent_id).toBeDefined();
    expect(result.status).toBe('pending');
    expect(mockMailer.sendVerificationEmail).toHaveBeenCalled();
  });
  
  it('should reject duplicate email', async () => {
    mockDb.prepare().get.mockReturnValueOnce({ id: 'existing-id' });
    
    const { register } = require('../../src/auth/service.js');
    
    await expect(register(mockDb, {
      email: 'existing@example.com',
      name: 'Test'
    })).rejects.toThrow('Email already registered');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/auth/service.test.ts`
Expected: FAIL

- [ ] **Step 3: Write auth service**

```typescript
// src/auth/service.ts
import type Database from 'better-sqlite3';
import type { RegisterInput, VerifyInput, LoginInput, AuthResponse, RegisterResponse, VerifyResponse } from './types.js';
import { createToken, getTokenExpiry } from './jwt.js';
import { sendVerificationEmail } from './mailer.js';
import { generateCode, createVerification, verifyCode, checkRateLimit } from './verification.js';
import { generateUUID } from '../lib/utils.js';

const INITIAL_CREDITS = 100;

export async function register(db: Database.Database, input: RegisterInput): Promise<RegisterResponse> {
  // Check if email already exists
  const existing = db.prepare('SELECT id FROM agents WHERE email = ?').get(input.email);
  if (existing) {
    throw new Error('Email already registered');
  }
  
  // Check rate limit
  const rateLimit = checkRateLimit(db, input.email);
  if (!rateLimit.allowed) {
    throw new Error(`Please wait ${rateLimit.waitSeconds} seconds before requesting another code`);
  }
  
  // Create agent with pending status
  const agentId = generateUUID();
  const now = Date.now();
  
  db.prepare(`
    INSERT INTO agents (id, name, email, description, status, credits, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)
  `).run(agentId, input.name, input.email, input.description || '', now, now);
  
  // Generate and store verification code
  const code = generateCode();
  createVerification(db, agentId, input.email, code);
  
  // Send verification email
  await sendVerificationEmail(input.email, code, input.name);
  
  return {
    agent_id: agentId,
    status: 'pending',
    message: 'Verification code sent to your email'
  };
}

export async function verify(db: Database.Database, input: VerifyInput): Promise<VerifyResponse> {
  const result = verifyCode(db, input.email, input.code);
  
  if (!result.valid) {
    throw new Error(result.error || 'Verification failed');
  }
  
  const domain = process.env.BOUNTY_DOMAIN || 'bounty.local';
  const address = `${result.agentId}@${domain}`;
  
  // Update agent status and address
  const now = Date.now();
  db.prepare(`
    UPDATE agents SET status = 'active', address = ?, credits = ?, updated_at = ?
    WHERE id = ?
  `).run(address, INITIAL_CREDITS, now, result.agentId);
  
  // Create credit transaction
  db.prepare(`
    INSERT INTO credit_transactions (id, agent_id, amount, type, description, created_at)
    VALUES (?, ?, ?, 'reward', 'Welcome bonus', ?)
  `).run(generateUUID(), result.agentId, INITIAL_CREDITS, now);
  
  // Generate token
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(result.agentId) as any;
  const token = await createToken({ sub: agent.id, email: agent.email });
  
  return {
    agent_id: agent.id,
    status: 'active',
    address,
    token,
    credits: INITIAL_CREDITS
  };
}

export async function login(db: Database.Database, input: LoginInput): Promise<AuthResponse> {
  let agent: any;
  
  if (input.agent_id) {
    agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(input.agent_id);
  } else if (input.email) {
    agent = db.prepare('SELECT * FROM agents WHERE email = ?').get(input.email);
  } else {
    throw new Error('Email or agent_id is required');
  }
  
  if (!agent) {
    throw new Error('Agent not found');
  }
  
  if (agent.status !== 'active') {
    throw new Error('Agent account is not active. Please verify your email first.');
  }
  
  const token = await createToken({ sub: agent.id, email: agent.email });
  
  return {
    token,
    expires_in: getTokenExpiry(),
    agent_id: agent.id,
    email: agent.email,
    address: agent.address
  };
}

export async function sendVerificationCode(db: Database.Database, email: string): Promise<void> {
  const agent = db.prepare('SELECT * FROM agents WHERE email = ?').get(email) as any;
  
  if (!agent) {
    throw new Error('Email not registered');
  }
  
  if (agent.status === 'active') {
    throw new Error('Email already verified');
  }
  
  const rateLimit = checkRateLimit(db, email);
  if (!rateLimit.allowed) {
    throw new Error(`Please wait ${rateLimit.waitSeconds} seconds before requesting another code`);
  }
  
  const code = generateCode();
  createVerification(db, agent.id, email, code);
  
  await sendVerificationEmail(email, code, agent.name);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/auth/service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/service.ts tests/auth/service.test.ts
git commit -m "feat: add auth service"
```

---

### Task 7: Auth Middleware

**Files:**
- Create: `src/auth/middleware.ts`
- Test: `tests/auth/middleware.test.ts` (new)

- [ ] **Step 1: Write middleware tests**

```typescript
// tests/auth/middleware.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Auth Middleware', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;
  
  beforeEach(() => {
    mockReq = { headers: {} };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };
    mockNext = vi.fn();
  });
  
  it('should reject request without Authorization header', async () => {
    const { authMiddleware } = require('../../src/auth/middleware.js');
    
    await authMiddleware(mockReq, mockRes, mockNext);
    
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'Authorization header required' });
    expect(mockNext).not.toHaveBeenCalled();
  });
  
  it('should reject invalid Bearer format', async () => {
    const { authMiddleware } = require('../../src/auth/middleware.js');
    mockReq.headers.authorization = 'Basic token123';
    
    await authMiddleware(mockReq, mockRes, mockNext);
    
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid authorization format' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/auth/middleware.test.ts`
Expected: FAIL

- [ ] **Step 3: Write middleware**

```typescript
// src/auth/middleware.ts
import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from './jwt.js';

export interface AuthenticatedRequest extends Request {
  agent?: {
    id: string;
    email: string;
  };
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    res.status(401).json({ error: 'Authorization header required' });
    return;
  }
  
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Invalid authorization format. Use: Bearer <token>' });
    return;
  }
  
  const token = authHeader.slice(7);
  
  try {
    const payload = await verifyToken(token);
    req.agent = {
      id: payload.sub,
      email: payload.email
    };
    next();
  } catch (error) {
    if (error instanceof Error && error.message.includes('expired')) {
      res.status(401).json({ error: 'Token expired' });
    } else {
      res.status(401).json({ error: 'Invalid token' });
    }
  }
}

// Optional: middleware that allows unauthenticated requests
export async function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }
  
  const token = authHeader.slice(7);
  
  try {
    const payload = await verifyToken(token);
    req.agent = {
      id: payload.sub,
      email: payload.email
    };
  } catch {
    // Ignore errors for optional auth
  }
  
  next();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/auth/middleware.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/middleware.ts tests/auth/middleware.test.ts
git commit -m "feat: add auth middleware"
```

---

### Task 8: Auth Routes

**Files:**
- Create: `src/auth/routes.ts`
- Test: `tests/auth/routes.test.ts` (new)

- [ ] **Step 1: Write routes tests**

```typescript
// tests/auth/routes.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Auth Routes', () => {
  it('should export register, verify, login, send-code routes', async () => {
    const routes = await import('../../src/auth/routes.js');
    expect(routes.registerRoute).toBeDefined();
    expect(routes.verifyRoute).toBeDefined();
    expect(routes.loginRoute).toBeDefined();
    expect(routes.sendCodeRoute).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/auth/routes.test.ts`
Expected: FAIL

- [ ] **Step 3: Write routes**

```typescript
// src/auth/routes.ts
import type { Request, Response } from 'express';
import type Database from 'better-sqlite3';
import type { RegisterInput, VerifyInput, LoginInput } from './types.js';
import { register, verify, login, sendVerificationCode } from './service.js';

export function createAuthRoutes(db: Database.Database) {
  const registerRoute = async (req: Request, res: Response) => {
    try {
      const input: RegisterInput = req.body;
      
      if (!input.email || !input.name) {
        res.status(400).json({ error: 'Email and name are required' });
        return;
      }
      
      if (!/^[\w.-]+@[\w.-]+\.\w+$/.test(input.email)) {
        res.status(400).json({ error: 'Invalid email format' });
        return;
      }
      
      const result = await register(db, input);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed';
      res.status(400).json({ error: message });
    }
  };
  
  const verifyRoute = async (req: Request, res: Response) => {
    try {
      const input: VerifyInput = req.body;
      
      if (!input.email || !input.code) {
        res.status(400).json({ error: 'Email and code are required' });
        return;
      }
      
      const result = await verify(db, input);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Verification failed';
      res.status(400).json({ error: message });
    }
  };
  
  const loginRoute = async (req: Request, res: Response) => {
    try {
      const input: LoginInput = req.body;
      
      if (!input.email && !input.agent_id) {
        res.status(400).json({ error: 'Email or agent_id is required' });
        return;
      }
      
      const result = await login(db, input);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      res.status(401).json({ error: message });
    }
  };
  
  const sendCodeRoute = async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        res.status(400).json({ error: 'Email is required' });
        return;
      }
      
      await sendVerificationCode(db, email);
      res.json({ message: 'Verification code sent' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send code';
      res.status(400).json({ error: message });
    }
  };
  
  return {
    registerRoute,
    verifyRoute,
    loginRoute,
    sendCodeRoute
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/auth/routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/routes.ts tests/auth/routes.test.ts
git commit -m "feat: add auth routes"
```

---

### Task 9: Integrate Auth into HTTP Server

**Files:**
- Modify: `src/im/server/http.ts`
- Test: `tests/api/integration.test.ts` (new)

- [ ] **Step 1: Write integration test**

```typescript
// tests/api/integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';

describe('API Integration', () => {
  let app: express.Application;
  
  beforeAll(async () => {
    // Setup test app with routes
    const { createAuthRoutes } = await import('../../src/auth/routes.js');
    const { authMiddleware } = await import('../../src/auth/middleware.js');
    
    app = express();
    app.use(express.json());
    
    const db = createTestDb();
    const auth = createAuthRoutes(db);
    
    // Public routes
    app.post('/api/auth/register', auth.registerRoute);
    app.post('/api/auth/verify', auth.verifyRoute);
    app.post('/api/auth/login', auth.loginRoute);
    app.post('/api/auth/send-code', auth.sendCodeRoute);
    
    // Protected route
    app.get('/api/agents/me', authMiddleware, (req: any, res) => {
      res.json({ agent: req.agent });
    });
  });
  
  it('should allow register without token', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@example.com', name: 'New Agent' });
    
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('pending');
  });
  
  it('should reject protected route without token', async () => {
    const response = await request(app)
      .get('/api/agents/me');
    
    expect(response.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/api/integration.test.ts`
Expected: FAIL (files don't exist)

- [ ] **Step 3: Modify HTTP server**

Add to `src/im/server/http.ts`:

```typescript
import { createAuthRoutes } from '../../auth/routes.js';
import { authMiddleware, type AuthenticatedRequest } from '../../auth/middleware.js';

// In createHTTPServer function:
const auth = createAuthRoutes(db);

// Public auth routes (no middleware)
app.post('/api/auth/register', auth.registerRoute);
app.post('/api/auth/verify', auth.verifyRoute);
app.post('/api/auth/login', auth.loginRoute);
app.post('/api/auth/send-code', auth.sendCodeRoute);

// Protected routes (with middleware)
app.get('/api/agents/me', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.agent!.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  res.json(agent);
});

// Protect existing business routes
app.use('/api/tasks', authMiddleware);
app.use('/api/messages', authMiddleware);
```

- [ ] **Step 4: Install supertest**

Run: `bun add -D supertest`
Expected: Package installed

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/api/integration.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/im/server/http.ts tests/api/integration.test.ts
git commit -m "feat: integrate auth into HTTP server"
```

---

### Task 10: Environment Configuration

**Files:**
- Create: `.env.example` ✅ (已创建)
- Create: `.env` ✅ (已创建)
- Modify: `src/bin/bounty.ts`

- [ ] **Step 1: Create .env.example** ✅

`.env.example` 已创建，包含所有必需的环境变量模板。

- [ ] **Step 2: Create .env** ✅

`.env` 已创建，包含实际的 163 邮箱配置。

- [ ] **Step 3: Modify bounty.ts to load env**

```typescript
// In src/bin/bounty.ts
import 'dotenv/config';  // Add at top
```

- [ ] **Step 4: Add env loading test**

```typescript
// tests/config/env.test.ts
import { describe, it, expect } from 'vitest';

describe('Environment Configuration', () => {
  it('should have required env variables documented', () => {
    const fs = require('fs');
    const content = fs.readFileSync('.env.example', 'utf-8');
    
    expect(content).toContain('BOUNTY_DOMAIN');
    expect(content).toContain('JWT_SECRET');
    expect(content).toContain('SMTP_HOST');
    expect(content).toContain('SMTP_FROM');
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add .env.example .env src/bin/bounty.ts tests/config/env.test.ts
git commit -m "feat: add environment configuration"
```

---

### Task 11: CLI Update

**Files:**
- Modify: `src/cli/commands/agent/register.ts`

- [ ] **Step 1: Update register command to use new API flow**

```typescript
// src/cli/commands/agent/register.ts
// Replace existing register logic with:

async function registerAgent(input: RegisterInput) {
  const response = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || 'Registration failed');
  }
  
  console.log(`\n✓ Registration initiated for ${input.email}`);
  console.log(`  Agent ID: ${data.agent_id}`);
  console.log(`  Status: ${data.status}`);
  console.log(`\n${data.message}`);
  console.log('\nNext: Check your email and verify with:');
  console.log(`  bounty agent verify --email ${input.email} --code <code>`);
}
```

- [ ] **Step 2: Add verify command**

```typescript
// src/cli/commands/agent/verify.ts (new)
import type { VerifyInput } from '../../../auth/types.js';

export async function verifyAgent(input: VerifyInput) {
  const response = await fetch(`${API_BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || 'Verification failed');
  }
  
  console.log(`\n✓ Email verified successfully!`);
  console.log(`  Agent ID: ${data.agent_id}`);
  console.log(`  Address: ${data.address}`);
  console.log(`  Credits: ${data.credits}`);
  console.log(`\nToken saved. You can now use:`);
  console.log(`  bounty agent info`);
  console.log(`  bounty tasks list`);
}
```

- [ ] **Step 3: Add login command**

```typescript
// src/cli/commands/agent/login.ts (new)
export async function loginAgent(email?: string) {
  const response = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  
  // Save token to config
}
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/agent/register.ts src/cli/commands/agent/verify.ts src/cli/commands/agent/login.ts
git commit -m "feat: update CLI for new auth flow"
```

---

### Task 12: Update Agent Service

**Files:**
- Modify: `src/lib/agent/index.ts`

- [ ] **Step 1: Update Agent type to include new fields**

```typescript
// src/lib/agent/index.ts
export interface Agent {
  id: string;
  name: string;
  email: string;
  description?: string;
  public_key?: string;
  credits: number;
  status: 'pending' | 'active' | 'suspended';  // Updated
  address?: string;  // NEW: agent@domain format
  created_at: number;
  updated_at: number;
}
```

- [ ] **Step 2: Update register method**

```typescript
// In AgentService.register(), change:
// 1. Default status to 'pending'
// 2. Default credits to 0
// 3. Return agent_id for verification flow
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent/index.ts
git commit -m "feat: update Agent model for pending status"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Database Schema | `src/lib/storage/database.ts` |
| 2 | Auth Types | `src/auth/types.ts` |
| 3 | JWT Utilities | `src/auth/jwt.ts` |
| 4 | SMTP Mailer | `src/auth/mailer.ts` |
| 5 | Verification Logic | `src/auth/verification.ts` |
| 6 | Auth Service | `src/auth/service.ts` |
| 7 | Auth Middleware | `src/auth/middleware.ts` |
| 8 | Auth Routes | `src/auth/routes.ts` |
| 9 | HTTP Server Integration | `src/im/server/http.ts` |
| 10 | Environment Config | `.env.example` |
| 11 | CLI Update | `src/cli/commands/agent/*.ts` |
| 12 | Agent Service Update | `src/lib/agent/index.ts` |

---

## Dependencies to Install

```bash
bun add jose nodemailer dotenv
bun add -D supertest @types/nodemailer
```

---

## Test Commands

```bash
# Run all tests
bun test

# Run specific test suite
bun test tests/auth/
bun test tests/db/

# Run with coverage
bun test --coverage
```
