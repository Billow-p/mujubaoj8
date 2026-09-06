import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import NewQuote from './pages/NewQuote';
import Layout from './components/Layout';
import { auth } from './api';
import { useAuth } from './store';

export default function App() {
  const setUser = useAuth((s) => s.setUser);

  useEffect(() => {
    const token = localStorage.getItem('mqs_token');
    if (token) {
      auth.me().then(setUser).catch(() => localStorage.removeItem('mqs_token'));
    }
  }, []);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/quotes/new" element={<NewQuote />} />
        <Route path="/quotes/:id" element={<div className="p-6">报价单详情（开发中）</div>} />
      </Route>
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
