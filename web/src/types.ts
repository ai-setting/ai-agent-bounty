// Domain types — aligned with bounty-server's /api/* responses

export type TaskStatus =
  | 'open'
  | 'grabbed'
  | 'submitted'
  | 'completed'
  | 'cancelled'
  | 'disputed';

export interface Task {
  id: string;
  title: string;
  description: string;
  type: string;
  reward: number;
  publisherId: string;
  publisherEmail: string;
  status: TaskStatus;
  assigneeId?: string;
  assigneeEmail?: string;
  tags: string[];
  requirements?: string[];
  deadline?: number;
  result?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export type AgentStatus = 'active' | 'pending' | 'suspended';

export interface Agent {
  id: string;
  name: string;
  email: string;
  status: AgentStatus;
  credits: number;
  address?: string;
  description?: string;
  created_at: number;
  updated_at?: number;
}

export interface AgentWithStats extends Agent {
  grabbedCount: number;
  completedCount: number;
  successRate: number;
}

export interface CreditTransaction {
  id: string;
  agent_id: string;
  amount: number;
  type: string;
  description: string;
  created_at: number;
}

export interface AuthResponse {
  token: string;
  expires_in: number;
  agent_id: string;
  email: string;
  address?: string;
}

export interface ApiError {
  error: string;
}
