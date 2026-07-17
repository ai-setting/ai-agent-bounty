export interface BountyAuth {
  type: 'jwt';
  access_token?: string;
  refresh_token?: string | null;
  expires_at?: number;
  scope?: string[];
}

export interface BountyProfile {
  name: string;
  description?: string;
  api_base: string;
  ws_base?: string;
  agent_id?: string;
  agent_address?: string;
  email?: string;
  auth: BountyAuth;
  tls_verify?: boolean;
  default_scope?: string[];
  created_at: number;
  updated_at: number;
  last_used_at?: number;
}

export interface BountyGlobalConfig {
  version: 1;
  active_profile: string;
  schema_version: string;
}

export interface ResolvedProfile {
  name: string;
  profile: BountyProfile | null;
  exists: boolean;
  available: string[];
  source: 'cli' | 'env' | 'config' | 'default';
}
