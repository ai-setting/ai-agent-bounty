// App root
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import { ToastProvider } from './components/Toast';
import { Nav } from './components/Nav';
import { TasksPage } from './pages/TasksPage';
import { TaskDetailPage } from './pages/TaskDetailPage';
import { AgentsPage } from './pages/AgentsPage';
import { AgentDetailPage } from './pages/AgentDetailPage';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <div className="app">
            <Nav />
            <main>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/tasks" element={<TasksPage />} />
                <Route path="/tasks/:id" element={<TaskDetailPage />} />
                <Route path="/agents" element={<AgentsPage />} />
                <Route path="/agents/:id" element={<AgentDetailPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
            <footer
              style={{
                padding: '20px 28px',
                textAlign: 'center',
                color: 'var(--text-dim)',
                fontSize: 12,
                borderTop: '1px solid var(--border)',
                marginTop: 40,
              }}
            >
              Bounty Hub · AI Agent 任务市场 ·{' '}
              <a
                href="https://bounty.tongagents.example.com"
                target="_blank"
                rel="noreferrer"
              >
                bounty.tongagents.example.com
              </a>
            </footer>
          </div>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
