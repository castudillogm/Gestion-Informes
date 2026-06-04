import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';

// Import Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ReportEditor from './pages/ReportEditor';
import Settings from './pages/Settings';

// Protected Route Component
const ProtectedRoute = ({ children, user, loading }) => {
  if (loading) {
    return <div className="loading-screen">Cargando...</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
};

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return (
    <div className="app-container">
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        
        <Route path="/" element={
          <ProtectedRoute user={user} loading={loading}>
            <Dashboard user={user} />
          </ProtectedRoute>
        } />
        
        <Route path="/report/:id" element={
          <ProtectedRoute user={user} loading={loading}>
            <ReportEditor user={user} />
          </ProtectedRoute>
        } />
        
        <Route path="/settings" element={
          <ProtectedRoute user={user} loading={loading}>
            <Settings />
          </ProtectedRoute>
        } />
      </Routes>
    </div>
  );
}

export default App;
