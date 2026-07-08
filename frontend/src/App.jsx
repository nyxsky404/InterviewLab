import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth.jsx";
import Login from "./pages/Login.jsx";
import Signup from "./pages/Signup.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import InterviewRoom from "./pages/InterviewRoom.jsx";
import Report from "./pages/Report.jsx";
import Landing from "./pages/Landing.jsx";

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="page-center">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  return (
    <Routes>
      {/* Public marketing landing */}
      <Route
        path="/"
        element={loading ? null : user ? <Navigate to="/dashboard" replace /> : <Landing />}
      />

      {/* Redirect old /landing to / */}
      <Route
        path="/landing"
        element={<Navigate to="/" replace />}
      />

      {/* Auth */}
      <Route
        path="/login"
        element={loading ? null : user ? <Navigate to="/dashboard" replace /> : <Login />}
      />
      <Route
        path="/signup"
        element={loading ? null : user ? <Navigate to="/dashboard" replace /> : <Signup />}
      />

      {/* Protected app routes */}
      <Route
        path="/dashboard"
        element={
          <Protected>
            <Dashboard />
          </Protected>
        }
      />
      <Route
        path="/interview/:id"
        element={
          <Protected>
            <InterviewRoom />
          </Protected>
        }
      />
      <Route
        path="/interview/:id/report"
        element={
          <Protected>
            <Report />
          </Protected>
        }
      />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
