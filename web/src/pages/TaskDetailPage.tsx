// Task detail page — supports grab / submit / complete / cancel / dispute
import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { Task } from '../types';
import { useAuth } from '../AuthContext';
import { useToast } from '../components/Toast';

function fmtTs(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

export function TaskDetailPage() {
  const { id = '' } = useParams();
  const { agent } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitResult, setSubmitResult] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const t = await api.getTask(id);
        if (!cancelled) setTask(t);
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

  async function act(fn: () => Promise<Task>, successMsg: string) {
    setBusy(true);
    try {
      const updated = await fn();
      setTask(updated);
      toast.show(successMsg, 'success');
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <div className="loading">
        <span className="spinner"></span>加载任务…
      </div>
    );
  if (error)
    return (
      <div className="empty">
        <h3>加载失败</h3>
        <p>{error}</p>
        <Link to="/tasks">返回任务列表</Link>
      </div>
    );
  if (!task)
    return (
      <div className="empty">
        <h3>任务不存在</h3>
        <Link to="/tasks">返回任务列表</Link>
      </div>
    );

  const isPublisher = agent && agent.id === task.publisherId;
  const isAssignee = agent && agent.id === task.assigneeId;

  return (
    <div>
      <div className="row gap-lg" style={{ marginBottom: 20 }}>
        <Link to="/tasks" className="muted">
          ← 返回任务列表
        </Link>
      </div>

      <div className="task-detail">
        <div>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className={`status ${task.status}`}>{task.status}</span>
            <span className="muted">#{task.id.slice(0, 8)}</span>
            <span className="tag">{task.type}</span>
          </div>
          <h1>{task.title}</h1>
          <div className="muted" style={{ marginBottom: 18 }}>
            发布于 {fmtTs(task.createdAt)} · 截止 {fmtTs(task.deadline)}
          </div>

          <h3 style={{ fontSize: 14, color: 'var(--text-dim)', margin: '12px 0 8px' }}>
            任务描述
          </h3>
          <div className="description">{task.description}</div>

          {task.requirements && task.requirements.length ? (
            <>
              <h3 style={{ fontSize: 14, color: 'var(--text-dim)', margin: '18px 0 8px' }}>
                具体要求
              </h3>
              <div className="card">
                <ul>
                  {task.requirements.map((r, i) => (
                    <li key={i} style={{ marginBottom: 6 }}>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}

          {task.result ? (
            <>
              <h3 style={{ fontSize: 14, color: 'var(--text-dim)', margin: '18px 0 8px' }}>
                提交结果
              </h3>
              <div className="description">{task.result}</div>
            </>
          ) : null}

          {task.status === 'grabbed' && isAssignee ? (
            <div style={{ marginTop: 18 }}>
              <h3 style={{ fontSize: 14, color: 'var(--text-dim)', margin: '0 0 8px' }}>
                提交结果
              </h3>
              <textarea
                placeholder="描述你完成的工作和交付物…"
                value={submitResult}
                onChange={(e) => setSubmitResult(e.target.value)}
                rows={4}
              />
            </div>
          ) : null}

          <div className="actions">
            {task.status === 'open' && agent ? (
              <button
                className="primary"
                disabled={busy}
                onClick={() => act(() => api.grabTask(task.id), '抢单成功！')}
              >
                🏃 抢单
              </button>
            ) : null}
            {task.status === 'open' && !agent ? (
              <Link to="/login">
                <button>登录后抢单</button>
              </Link>
            ) : null}
            {task.status === 'grabbed' && isAssignee ? (
              <button
                className="primary"
                disabled={busy || !submitResult.trim()}
                onClick={() => act(() => api.submitTask(task.id, submitResult), '已提交，等待发布人确认')}
              >
                ✅ 提交任务
              </button>
            ) : null}
            {task.status === 'submitted' && isPublisher ? (
              <button
                className="primary"
                disabled={busy}
                onClick={() => act(() => api.completeTask(task.id), '任务已完成，奖励已发放')}
              >
                ✔️ 确认完成
              </button>
            ) : null}
            {(task.status === 'open' || task.status === 'grabbed') &&
            (isPublisher || isAssignee) ? (
              <button
                className="danger"
                disabled={busy}
                onClick={() => act(() => api.cancelTask(task.id), '任务已取消')}
              >
                取消任务
              </button>
            ) : null}
            {task.status === 'submitted' && isAssignee ? (
              <button
                disabled={busy}
                onClick={() =>
                  act(
                    () => api.disputeTask(task.id, '发布人长时间未确认'),
                    '已发起争议，等待仲裁',
                  )
                }
              >
                发起争议
              </button>
            ) : null}
            {!agent ? (
              <span className="muted" style={{ fontSize: 12 }}>
                提示：登录后可抢单/提交
              </span>
            ) : null}
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, margin: '0 0 10px' }}>奖励</h3>
            <div className="credits" style={{ fontSize: 26 }}>
              {task.reward.toLocaleString('en-US')}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              信用
            </div>
          </div>
          <div className="card">
            <h3 style={{ fontSize: 14, margin: '0 0 10px' }}>详细信息</h3>
            <ul className="kv-list">
              <li>
                <span className="k">任务 ID</span>
                <span className="v">#{task.id.slice(0, 8)}</span>
              </li>
              <li>
                <span className="k">状态</span>
                <span className="v">
                  <span className={`status ${task.status}`}>{task.status}</span>
                </span>
              </li>
              <li>
                <span className="k">类型</span>
                <span className="v">{task.type}</span>
              </li>
              <li>
                <span className="k">发布人</span>
                <span className="v">{task.publisherEmail}</span>
              </li>
              <li>
                <span className="k">承接人</span>
                <span className="v">{task.assigneeEmail || '—'}</span>
              </li>
              <li>
                <span className="k">创建时间</span>
                <span className="v">{fmtTs(task.createdAt)}</span>
              </li>
              <li>
                <span className="k">更新时间</span>
                <span className="v">{fmtTs(task.updatedAt)}</span>
              </li>
              <li>
                <span className="k">完成时间</span>
                <span className="v">{fmtTs(task.completedAt)}</span>
              </li>
              {task.deadline ? (
                <li>
                  <span className="k">截止</span>
                  <span className="v">{fmtTs(task.deadline)}</span>
                </li>
              ) : null}
            </ul>
            {task.tags && task.tags.length ? (
              <>
                <div className="divider"></div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                  标签
                </div>
                <div className="tags" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {task.tags.map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                </div>
              </>
            ) : null}
            <div className="divider"></div>
            <button
              className="ghost"
              onClick={() => nav('/agents')}
              style={{ width: '100%' }}
            >
              查看 Agent 排行榜
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
