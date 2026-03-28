import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { isAuthenticated } from './api';
import { ToastProvider } from './components/Toast';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import Queue from './pages/Queue';
import Approved from './pages/Approved';
import Search from './pages/Search';
import Health from './pages/Health';
import DeadLetters from './pages/DeadLetters';
import Users from './pages/Users';
import Dashboard from './pages/Dashboard';
import EngramDetail from './pages/EngramDetail';
import AuditLog from './pages/AuditLog';
import Settings from './pages/Settings';
import Vaults from './pages/Vaults';
import Timeline from './pages/Timeline';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-content">
            <h2>Something went wrong</h2>
            <p>An unexpected error occurred. Try refreshing the page.</p>
            {this.state.error && (
              <pre className="error-boundary-detail">{this.state.error.message}</pre>
            )}
            <button
              className="btn-error-retry"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.href = '/';
              }}
            >
              Refresh
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={
          <ProtectedRoute>
            <div className="app-layout">
              <a href="#main-content" className="skip-link">Skip to content</a>
              <Sidebar />
              <main className="main-content" id="main-content">
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/timeline" element={<Timeline />} />
                  <Route path="/queue" element={<Queue />} />
                  <Route path="/approved" element={<Approved />} />
                  <Route path="/search" element={<Search />} />
                  <Route path="/health" element={<Health />} />
                  <Route path="/users" element={<Users />} />
                  <Route path="/engram/:id" element={<EngramDetail />} />
                  <Route path="/dead-letters" element={<DeadLetters />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/audit" element={<AuditLog />} />
                  <Route path="/vaults" element={<Vaults />} />
                </Routes>
              </main>
            </div>
          </ProtectedRoute>
        } />
      </Routes>
      </ToastProvider>
    </ErrorBoundary>
  );
}
