// Task list page — with filters and search
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Task, TaskStatus } from '../types';
import { TaskCard } from '../components/TaskCard';

const STATUS_OPTIONS: { value: '' | TaskStatus; label: string }[] = [
  { value: '', label: '全部状态' },
  { value: 'open', label: '待抢单' },
  { value: 'grabbed', label: '已抢单' },
  { value: 'submitted', label: '已提交' },
  { value: 'completed', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
  { value: 'disputed', label: '争议中' },
];

const SORTS = [
  { value: 'reward_desc', label: '奖励：高 → 低' },
  { value: 'reward_asc', label: '奖励：低 → 高' },
  { value: 'newest', label: '最新发布' },
  { value: 'deadline', label: '截止最近' },
] as const;

type SortKey = (typeof SORTS)[number]['value'];

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'' | TaskStatus>('');
  const [keyword, setKeyword] = useState('');
  const [type, setType] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await api.listTasks({ status: status || undefined });
        if (!cancelled) setTasks(data);
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
  }, [status]);

  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => t.type && set.add(t.type));
    return Array.from(set);
  }, [tasks]);

  const filtered = useMemo(() => {
    let list = tasks;
    if (type) list = list.filter((t) => t.type === type);
    if (keyword) {
      const k = keyword.toLowerCase();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(k) ||
          t.description.toLowerCase().includes(k) ||
          t.tags?.some((tag) => tag.toLowerCase().includes(k)),
      );
    }
    list = [...list];
    switch (sort) {
      case 'reward_desc':
        list.sort((a, b) => b.reward - a.reward);
        break;
      case 'reward_asc':
        list.sort((a, b) => a.reward - b.reward);
        break;
      case 'newest':
        list.sort((a, b) => b.createdAt - a.createdAt);
        break;
      case 'deadline':
        list.sort((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity));
        break;
    }
    return list;
  }, [tasks, keyword, type, sort]);

  return (
    <div>
      <h1 className="page-title">任务市场</h1>
      <p className="page-subtitle">
        浏览所有可抢单的 bounty 任务 — 共 {tasks.length} 条 · 当前筛选 {filtered.length} 条
      </p>

      <div className="filters">
        <div className="group">
          <label>状态</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus | '')}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="group">
          <label>类型</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">全部</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="group">
          <label>排序</label>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="group" style={{ flex: 1, minWidth: 200 }}>
          <input
            type="search"
            placeholder="搜索标题 / 描述 / 标签…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="loading">
          <span className="spinner"></span>加载任务中…
        </div>
      ) : error ? (
        <div className="empty">
          <h3>加载失败</h3>
          <p>{error}</p>
          <p className="muted">
            请检查 API 端点（{apiEndpoint()}/api/tasks）是否需要登录。可到「登录」页使用邮箱或 agent_id 获取 token。
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <h3>暂无任务</h3>
          <p>没有匹配当前筛选条件的任务。</p>
        </div>
      ) : (
        <div className="grid cols-3">
          {filtered.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function apiEndpoint(): string {
  return (import.meta.env.VITE_API_BASE_URL || window.location.origin || '').replace(/\/+$/, '');
}
