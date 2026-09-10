import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import NewQuote from './pages/NewQuote';
import ConfiguredQuote from './pages/ConfiguredQuote';
import QuoteDetail from './pages/QuoteDetail';
import Customers from './pages/Customers';
import QuoteItems from './pages/QuoteItems';
import Materials from './pages/Materials';
import Parameters from './pages/Parameters';
import ConfigCenter from './pages/ConfigCenter';
import SharePage from './pages/SharePage';
import Admin from './pages/Admin';
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
      {/* 客户查看报价单：免登录，独立于后台布局 */}
      <Route path="/share/:token" element={<SharePage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/quotes/new" element={<ConfiguredQuote />} />
        <Route path="/quotes/new/advanced" element={<NewQuote />} />
        <Route path="/quotes/:id" element={<QuoteDetail />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/settings/config" element={<ConfigCenter />} />
        <Route path="/settings/quote-items" element={<QuoteItems />} />
        <Route path="/settings/materials" element={<Materials />} />
        <Route path="/settings/parameters" element={<Parameters />} />
        <Route path="/admin" element={<Admin />} />
      </Route>
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
