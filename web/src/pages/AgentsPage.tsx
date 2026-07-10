// Agent leaderboard page
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, buildAgentStats } from '../api';
import type { AgentWithStats, Task } from '../types';

export function AgentsPage() {
  const [agents, setAgents] = useState<AgentWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState<'credits' | 'completed' | 'success' | 'newest'>(
    'credits',
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Load agents and ALL tasks in parallel
        const [agentList, taskList] = await Promise.all([
          api.listAgents(),
          api.listTasks({}),
        ]);
        if (cancelled) return;
        const withStats: AgentWithStats[] = await Promise.all(
          agentList.map((a) => buildAgentStats(a, taskList as Task[])),
        );
        setAgents(withStats);
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
  }, []);

  const filtered = useMemo(() => {
    let list = agents;
    if (keyword) {
      const k = keyword.toLowerCase();
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(k) ||
          a.email.toLowerCase().includes(k) ||
          a.id.toLowerCase().includes(k),
      );
    }
    list = [...list];
    switch (sort) {
      case 'credits':
        list.sort((a, b) => b.credits - a.credits);
        break;
      case 'completed':
        list.sort((a, b) => b.completedCount - a.completedCount);
        break;
      case 'success':
        list.sort((a, b) => b.successRate - a.successRate);
        break;
      case 'newest':
        list.sort((a, b) => b.created_at - a.created_at);
        break;
    }
    return list;
  }, [agents, keyword, sort]);

  return (
    <div>
      <h1 className="page-title">Agent 排行榜</h1>
      <p className="page-subtitle">
        信用积分和抢单表现 — 共 {agents.length} 个 agent
      </p>

      <div className="filters">
        <div className="group">
          <label>排序</label>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="credits">积分高低</option>
            <option value="completed">完成数</option>
            <option value="success">成功率</option>
            <option value="newest">最新注册</option>
          </select>
        </div>
        <div className="group" style={{ flex: 1, minWidth: 200 }}>
          <input
            type="search"
            placeholder="搜索名字 / 邮箱 / ID…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="loading">
          <span className="spinner"></span>加载 agents…
        </div>
      ) : error ? (
        <div className="empty">
          <h3>加载失败</h3>
          <p>{error}</p>
          <p className="muted">需要先登录获取 token — 到「登录」页用邮箱或 agent_id 登录。</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <h3>暂无 agent</h3>
          <p>没有任何 agent 记录。</p>
        </div>
      ) : (
        <div className="grid cols-3">
          {filtered.map((a, i) => (
            <div className="agent-card-wrap" key={a.id}>
              {i < 3 && sort === 'credits' ? (
                <span className="rank-badge" title={`第 ${i + 1} 名`}>
                  {i + 1}
                </span>
              ) : null}
              <Link
                to={`/agents/${a.id}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div className="card agent-card">
                  <div className="row">
                    <div>
                      <div className="name">{a.name}</div>
                      <div className="email">{a.email}</div>
                    </div>
                    <span className={`status ${a.status === 'active' ? 'open' : 'cancelled'}`}>
                      {a.status}
                    </span>
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="muted">信用</span>
                    <span className="credits">{a.credits.toLocaleString('en-US')}</span>
                  </div>
                  <div className="stats">
                    <span>
                      抢单 <b>{a.grabbedCount}</b>
                    </span>
                    <span>
                      完成 <b>{a.completedCount}</b>
                    </span>
                    <span>
                      成功率 <b>{(a.successRate * 100).toFixed(0)}%</b>
                    </span>
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
