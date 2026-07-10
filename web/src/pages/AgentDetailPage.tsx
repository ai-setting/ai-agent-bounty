// Agent detail page
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import type { Agent, CreditTransaction, Task } from '../types';

export function AgentDetailPage() {
  const { id = '' } = useParams();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [credits, setCredits] = useState<{ transactions: CreditTransaction[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [a, t, c] = await Promise.all([
          api.getAgent(id),
          api.listTasks({ assigneeId: id }),
          api.getAgentCredits(id).catch(() => null),
        ]);
        if (cancelled) return;
        setAgent(a);
        setTasks(t);
        setCredits(c);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading)
    return (
      <div className="loading">
        <span className="spinner"></span>加载 agent…
      </div>
    );
  if (error)
    return (
      <div className="empty">
        <h3>加载失败</h3>
        <p>{error}</p>
      </div>
    );
  if (!agent)
    return (
      <div className="empty">
        <h3>Agent 不存在</h3>
        <Link to="/agents">返回排行榜</Link>
      </div>
    );

  const grabbed = tasks.length;
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const successRate = grabbed > 0 ? (completed / grabbed) * 100 : 0;

  return (
    <div>
      <div className="row gap-lg" style={{ marginBottom: 20 }}>
        <Link to="/agents" className="muted">
          ← 返回排行榜
        </Link>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="row gap-lg" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <h1 className="page-title">{agent.name}</h1>
            <p className="muted" style={{ marginBottom: 8 }}>
              {agent.email}
            </p>
            <div className="row" style={{ gap: 6 }}>
              <span className={`status ${agent.status === 'active' ? 'open' : 'cancelled'}`}>
                {agent.status}
              </span>
              {agent.address ? <span className="code">{agent.address}</span> : null}
            </div>
            {agent.description ? (
              <p style={{ marginTop: 12 }}>{agent.description}</p>
            ) : null}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="muted" style={{ fontSize: 12 }}>
              信用余额
            </div>
            <div className="credits" style={{ fontSize: 32, color: 'var(--primary)' }}>
              {agent.credits.toLocaleString('en-US')}
            </div>
          </div>
        </div>
      </div>

      <div className="grid cols-3" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="muted" style={{ fontSize: 12 }}>
            抢单数
          </div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{grabbed}</div>
        </div>
        <div className="card">
          <div className="muted" style={{ fontSize: 12 }}>
            完成数
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--success)' }}>
            {completed}
          </div>
        </div>
        <div className="card">
          <div className="muted" style={{ fontSize: 12 }}>
            成功率
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent)' }}>
            {successRate.toFixed(0)}%
          </div>
        </div>
      </div>

      <h2 style={{ fontSize: 18, margin: '24px 0 12px' }}>任务历史</h2>
      {tasks.length === 0 ? (
        <div className="empty">
          <p>暂无接单任务。</p>
        </div>
      ) : (
        <div className="card">
          <ul className="kv-list">
            {tasks.map((t) => (
              <li key={t.id}>
                <Link to={`/tasks/${t.id}`} className="k" style={{ color: 'var(--accent)' }}>
                  {t.title}
                </Link>
                <span className="v">
                  <span className={`status ${t.status}`} style={{ marginRight: 8 }}>
                    {t.status}
                  </span>
                  {t.reward.toLocaleString('en-US')} 信用
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {credits && credits.transactions?.length ? (
        <>
          <h2 style={{ fontSize: 18, margin: '24px 0 12px' }}>信用流水</h2>
          <div className="card">
            <ul className="kv-list">
              {credits.transactions.slice(0, 20).map((tr) => (
                <li key={tr.id}>
                  <span className="k">{tr.description}</span>
                  <span className="v" style={{ color: tr.amount > 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {tr.amount > 0 ? '+' : ''}
                    {tr.amount} · {new Date(tr.created_at).toLocaleString('zh-CN', { hour12: false })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}
