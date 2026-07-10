// API client — talks to bounty-server over /api/*
import type {
  Agent,
  AgentWithStats,
  AuthResponse,
  CreditTransaction,
  Task,
  TaskStatus,
} from './types';

// Base URL strategy:
// 1. VITE_API_BASE_URL — explicit override (e.g. http://bounty-server:4005)
// 2. window.location.origin — same-origin via Ingress (k8s prod)
// 3. fallback '' (relative) — for same-origin dev
function resolveBaseUrl(): string {
  const envBase = (import.meta.env.VITE_API_BASE_URL || '').trim();
  if (envBase) return envBase.replace(/\/+$/, '');
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

const BASE = resolveBaseUrl();

let authToken: string | null =
  typeof localStorage !== 'undefined' ? localStorage.getItem('bounty_token') : null;

export function setAuthToken(token: string | null) {
  authToken = token;
  if (typeof localStorage !== 'undefined') {
    if (token) localStorage.setItem('bounty_token', token);
    else localStorage.removeItem('bounty_token');
  }
}

export function getAuthToken(): string | null {
  return authToken;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  const url = `${BASE}${path}`;
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if ('error' in obj && obj.error != null) {
        errMsg = String(obj.error);
      }
    }
    const error: Error & { status?: number; payload?: unknown } = new Error(errMsg);
    error.status = res.status;
    error.payload = data;
    throw error;
  }
  return data as T;
}

export const api = {
  // ===== Health =====
  health: () => request<{ status: string; timestamp: number }>('/health'),

  // ===== Auth =====
  login: (email?: string, agentId?: string) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, agent_id: agentId }),
    }),
  register: (email: string, name: string, description?: string) =>
    request<{ agent_id: string; status: 'pending'; message: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, name, description }),
    }),
  sendCode: (email: string) =>
    request<{ message: string }>('/api/auth/send-code', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  verify: (email: string, code: string) =>
    request<AuthResponse>('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),

  // ===== Agents =====
  listAgents: () => request<Agent[]>('/api/agents'),
  getAgent: (id: string) => request<Agent>(`/api/agents/${id}`),
  getAgentCredits: (id: string) =>
    request<{ credits: number; transactions: CreditTransaction[] }>(
      `/api/agents/${id}/credits`,
    ),
  me: () => request<Agent>('/api/agents/me'),

  // ===== Tasks =====
  listTasks: (filter: {
    status?: TaskStatus;
    type?: string;
    publisherId?: string;
    assigneeId?: string;
  } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(filter).forEach(([k, v]) => {
      if (v) qs.set(k, v);
    });
    const q = qs.toString();
    return request<Task[]>(`/api/tasks${q ? `?${q}` : ''}`);
  },
  getTask: (id: string) => request<Task>(`/api/tasks/${id}`),
  createTask: (input: {
    title: string;
    description: string;
    type: string;
    reward: number;
    tags?: string[];
    requirements?: string[];
    deadline?: number;
  }) =>
    request<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  grabTask: (id: string) =>
    request<Task>(`/api/tasks/${id}/grab`, { method: 'PUT' }),
  submitTask: (id: string, result: string) =>
    request<Task>(`/api/tasks/${id}/submit`, {
      method: 'PUT',
      body: JSON.stringify({ result }),
    }),
  completeTask: (id: string) =>
    request<Task>(`/api/tasks/${id}/complete`, { method: 'PUT' }),
  cancelTask: (id: string) =>
    request<Task>(`/api/tasks/${id}/cancel`, { method: 'PUT' }),
  disputeTask: (id: string, reason: string) =>
    request<Task>(`/api/tasks/${id}/dispute`, {
      method: 'PUT',
      body: JSON.stringify({ reason }),
    }),
};

// Build aggregated agent stats from tasks
export async function buildAgentStats(agent: Agent, tasks: Task[]): Promise<AgentWithStats> {
  const grabbed = tasks.filter(
    (t) => t.assigneeId === agent.id && t.status !== 'open' && t.status !== 'cancelled',
  );
  const completed = tasks.filter(
    (t) => t.assigneeId === agent.id && t.status === 'completed',
  );
  const submitted = tasks.filter(
    (t) => t.assigneeId === agent.id && t.status === 'submitted',
  );
  const finished = completed.length + submitted.length;
  const successRate = finished === 0 ? 0 : completed.length / finished;
  return {
    ...agent,
    grabbedCount: grabbed.length,
    completedCount: completed.length,
    successRate,
  };
}
