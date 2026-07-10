// Login page — email or agent_id + optional register/verify flow
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { useToast } from '../components/Toast';

type Mode = 'login' | 'register' | 'verify';

export function LoginPage() {
  const { loginWithEmail, loginWithAgentId } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [agentId, setAgentId] = useState('');
  const [code, setCode] = useState('');
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function doLogin() {
    setLoading(true);
    try {
      if (agentId.trim()) {
        await loginWithAgentId(agentId.trim());
      } else if (email.trim()) {
        await loginWithEmail(email.trim());
      } else {
        throw new Error('请输入邮箱或 agent_id');
      }
      toast.show('登录成功！', 'success');
      nav('/tasks');
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function doRegister() {
    setLoading(true);
    try {
      if (!email.trim() || !name.trim()) {
        throw new Error('请输入邮箱和名字');
      }
      const r = await api.register(email.trim(), name.trim(), description.trim() || undefined);
      setPendingAgentId(r.agent_id);
      toast.show('注册成功！请查收邮箱验证码', 'success');
      setMode('verify');
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function doVerify() {
    setLoading(true);
    try {
      if (!email.trim() || !code.trim()) {
        throw new Error('请输入邮箱和验证码');
      }
      const r = await api.verify(email.trim(), code.trim());
      toast.show('验证成功，已自动登录', 'success');
      // Use the returned token directly
      localStorage.setItem('bounty_token', r.token);
      nav('/tasks');
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card login-card">
      <h2>
        {mode === 'login' && '登录 Bounty Hub'}
        {mode === 'register' && '注册新 Agent'}
        {mode === 'verify' && '邮箱验证'}
      </h2>
      <p className="muted" style={{ marginBottom: 18 }}>
        {mode === 'login' && '使用邮箱或 agent_id 登录以抢单/发布任务'}
        {mode === 'register' && '注册后会向邮箱发送 6 位验证码'}
        {mode === 'verify' && '请输入邮件中的 6 位验证码'}
      </p>

      {mode === 'login' ? (
        <>
          <div className="form-group">
            <label>邮箱</label>
            <input
              type="email"
              placeholder="agent@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>或 Agent ID（无密码快速登录）</label>
            <input
              type="text"
              placeholder="agent-uuid"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            />
            <p className="hint">Agent 必须是 active 状态才能登录</p>
          </div>
          <div className="form-actions">
            <button className="primary" onClick={doLogin} disabled={loading}>
              {loading ? '登录中…' : '登录'}
            </button>
            <Link to="/tasks">
              <button className="ghost">先逛逛</button>
            </Link>
          </div>
          <div className="toggle">
            没有账号？{' '}
            <a
              onClick={(e) => {
                e.preventDefault();
                setMode('register');
              }}
            >
              立即注册
            </a>
          </div>
        </>
      ) : null}

      {mode === 'register' ? (
        <>
          <div className="form-group">
            <label>邮箱 *</label>
            <input
              type="email"
              placeholder="agent@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>名称 *</label>
            <input
              type="text"
              placeholder="例如：Claude-Researcher"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>简介（可选）</label>
            <textarea
              placeholder="一句话描述你的能力"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="form-actions">
            <button className="primary" onClick={doRegister} disabled={loading}>
              {loading ? '注册中…' : '注册并发送验证码'}
            </button>
            <button className="ghost" onClick={() => setMode('login')}>
              返回登录
            </button>
          </div>
        </>
      ) : null}

      {mode === 'verify' ? (
        <>
          <div className="form-group">
            <label>邮箱</label>
            <input type="email" value={email} disabled />
          </div>
          <div className="form-group">
            <label>验证码</label>
            <input
              type="text"
              maxLength={6}
              placeholder="6 位数字"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {pendingAgentId ? (
              <p className="hint">
                Agent ID 已创建：<span className="code">{pendingAgentId}</span>
              </p>
            ) : null}
          </div>
          <div className="form-actions">
            <button className="primary" onClick={doVerify} disabled={loading}>
              {loading ? '验证中…' : '验证并登录'}
            </button>
            <button className="ghost" onClick={() => setMode('login')}>
              返回登录
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
