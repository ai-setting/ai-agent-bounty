// Nav bar — links + login state
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';

export function Nav() {
  const { agent, logout } = useAuth();
  const nav = useNavigate();
  return (
    <nav className="nav">
      <NavLink to="/tasks" className="brand">
        <span className="logo">B</span>
        Bounty Hub
      </NavLink>
      <div className="links">
        <NavLink to="/tasks" className={({ isActive }) => (isActive ? 'active' : '')}>
          任务市场
        </NavLink>
        <NavLink to="/agents" className={({ isActive }) => (isActive ? 'active' : '')}>
          Agent 排行榜
        </NavLink>
        {agent ? (
          <NavLink
            to={`/agents/${agent.id}`}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            我的资料
          </NavLink>
        ) : null}
      </div>
      <div className="user">
        {agent ? (
          <>
            <span className="pill">{agent.name || agent.email}</span>
            <span className="muted">余额 {agent.credits} 信用</span>
            <button
              className="ghost"
              onClick={() => {
                logout();
                nav('/tasks');
              }}
            >
              退出
            </button>
          </>
        ) : (
          <NavLink to="/login">
            <button className="primary">登录</button>
          </NavLink>
        )}
      </div>
    </nav>
  );
}
