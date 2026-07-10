// Task card — used on the task list
import { Link } from 'react-router-dom';
import type { Task, TaskStatus } from '../types';

function fmtReward(n: number): string {
  return `${n.toLocaleString('en-US')} 信用`;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', { hour12: false });
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function TaskCard({ task }: { task: Task }) {
  return (
    <Link to={`/tasks/${task.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="card task-card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className={`status ${task.status as TaskStatus}`}>{task.status}</span>
          <span className="reward">{fmtReward(task.reward)}</span>
        </div>
        <h3 className="title">{task.title}</h3>
        <p className="desc">{task.description}</p>
        <div className="tags">
          {task.tags?.length
            ? task.tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))
            : null}
          <span className="tag">{task.type || 'bounty'}</span>
        </div>
        <div className="meta">
          <span>by {task.publisherEmail}</span>
          <span className="code">#{shortId(task.id)}</span>
        </div>
        {task.deadline ? (
          <div className="meta">
            <span>截止：{fmtTime(task.deadline)}</span>
          </div>
        ) : null}
      </div>
    </Link>
  );
}
