import { describe, it, expect } from 'bun:test';
import type {
  AuthTokenPayload,
  RegisterInput,
  SendCodeInput,
  VerifyInput,
  LoginInput,
  AuthResponse,
  RegisterResponse,
  VerifyResponse,
  AgentProfile,
} from '../../src/auth/types';

describe('Auth Types', () => {
  it('should have correct AuthTokenPayload structure', () => {
    const payload: AuthTokenPayload = { sub: 'agent_123', email: 'test@example.com', iat: Date.now(), exp: Date.now() + 86400 };
    expect(payload.sub).toBe('agent_123');
    expect(payload.email).toBe('test@example.com');
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
  });

  it('should have correct RegisterInput structure', () => {
    const input: RegisterInput = { email: 'test@example.com', name: 'Test Agent' };
    expect(input.email).toBe('test@example.com');
    expect(input.name).toBe('Test Agent');
    expect(input.description).toBeUndefined();
  });

  it('should allow optional description in RegisterInput', () => {
    const input: RegisterInput = { email: 'test@example.com', name: 'Test Agent', description: 'A test agent' };
    expect(input.description).toBe('A test agent');
  });

  it('should have correct SendCodeInput structure', () => {
    const input: SendCodeInput = { email: 'test@example.com' };
    expect(input.email).toBe('test@example.com');
  });

  it('should have correct VerifyInput structure', () => {
    const input: VerifyInput = { email: 'test@example.com', code: '123456' };
    expect(input.email).toBe('test@example.com');
    expect(input.code).toBe('123456');
  });

  it('should allow email in LoginInput', () => {
    const input: LoginInput = { email: 'test@example.com' };
    expect(input.email).toBe('test@example.com');
    expect(input.agent_id).toBeUndefined();
  });

  it('should allow agent_id in LoginInput', () => {
    const input: LoginInput = { agent_id: 'agent_123' };
    expect(input.agent_id).toBe('agent_123');
    expect(input.email).toBeUndefined();
  });

  it('should have correct AuthResponse structure', () => {
    const resp: AuthResponse = { token: 'jwt_token', expires_in: 86400, agent_id: 'agent_123', email: 'test@example.com' };
    expect(resp.token).toBe('jwt_token');
    expect(resp.expires_in).toBe(86400);
    expect(resp.agent_id).toBe('agent_123');
    expect(resp.email).toBe('test@example.com');
    expect(resp.address).toBeUndefined();
  });

  it('should allow optional address in AuthResponse', () => {
    const resp: AuthResponse = { token: 'jwt_token', expires_in: 86400, agent_id: 'agent_123', email: 'test@example.com', address: 'agent_123@bounty.example.com' };
    expect(resp.address).toBe('agent_123@bounty.example.com');
  });

  it('should have correct RegisterResponse structure', () => {
    const resp: RegisterResponse = { agent_id: 'agent_123', status: 'pending', message: 'Verification code sent' };
    expect(resp.agent_id).toBe('agent_123');
    expect(resp.status).toBe('pending');
    expect(resp.message).toBe('Verification code sent');
  });

  it('should have correct VerifyResponse structure', () => {
    const resp: VerifyResponse = { agent_id: 'agent_123', status: 'active', address: 'agent_123@bounty.example.com', token: 'jwt_token', credits: 100 };
    expect(resp.agent_id).toBe('agent_123');
    expect(resp.status).toBe('active');
    expect(resp.address).toBe('agent_123@bounty.example.com');
    expect(resp.token).toBe('jwt_token');
    expect(resp.credits).toBe(100);
  });

  it('should have correct AgentProfile structure', () => {
    const profile: AgentProfile = { id: 'agent_123', name: 'Test Agent', email: 'test@example.com', credits: 100, status: 'active', created_at: Date.now() };
    expect(profile.id).toBe('agent_123');
    expect(profile.name).toBe('Test Agent');
    expect(profile.email).toBe('test@example.com');
    expect(profile.credits).toBe(100);
    expect(profile.status).toBe('active');
    expect(profile.created_at).toBeDefined();
    expect(profile.address).toBeUndefined();
    expect(profile.description).toBeUndefined();
  });

  it('should allow optional fields in AgentProfile', () => {
    const profile: AgentProfile = { id: 'agent_123', name: 'Test Agent', email: 'test@example.com', address: 'agent_123@bounty.example.com', description: 'A test agent', credits: 100, status: 'active', created_at: Date.now() };
    expect(profile.address).toBe('agent_123@bounty.example.com');
    expect(profile.description).toBe('A test agent');
  });
});
