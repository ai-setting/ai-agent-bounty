// Auth context — exposes current agent + login/logout to the rest of the app
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getAuthToken, setAuthToken } from './api';
import type { Agent } from './types';

interface AuthState {
  agent: Agent | null;
  loading: boolean;
  loginWithEmail: (email: string) => Promise<void>;
  loginWithAgentId: (agentId: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState<boolean>(!!getAuthToken());

  // Try to load the current agent on mount if a token exists
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      if (!getAuthToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.me();
        if (!cancelled) setAgent(me);
      } catch (e) {
        // Token invalid — clear it
        setAuthToken(null);
        if (!cancelled) setAgent(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (payload: { email?: string; agent_id?: string }) => {
    const res = await api.login(payload.email, payload.agent_id);
    setAuthToken(res.token);
    setAgent({
      id: res.agent_id,
      email: res.email,
      name: res.email.split('@')[0],
      status: 'active',
      credits: 0,
      address: res.address,
      created_at: Date.now(),
    });
  }, []);

  const loginWithEmail = useCallback(
    async (email: string) => {
      await login({ email });
    },
    [login],
  );

  const loginWithAgentId = useCallback(
    async (agentId: string) => {
      await login({ agent_id: agentId });
    },
    [login],
  );

  const logout = useCallback(() => {
    setAuthToken(null);
    setAgent(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ agent, loading, loginWithEmail, loginWithAgentId, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
