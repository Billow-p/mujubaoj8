import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Landing from './pages/Landing';
import NewQuote from './pages/NewQuote';
import ConfiguredQuote from './pages/ConfiguredQuote';
import QuoteDetail from './pages/QuoteDetail';
import Customers from './pages/Customers';
import Materials from './pages/Materials';
import ConfigCenter from './pages/ConfigCenter';
import SharePage from './pages/SharePage';
import Admin from './pages/Admin';
import PlatformAdmin from './pages/PlatformAdmin';
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
      {/* 公开首页（营销 + 登录入口） */}
      <Route path="/" element={<Landing />} />
      {/* 客户查看报价单：免登录，独立于后台布局 */}
      <Route path="/share/:token" element={<SharePage />} />
      <Route element={<Layout />}>
        {/* 业务 */}
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/quotes/new" element={<ConfiguredQuote />} />
        <Route path="/quotes/new/advanced" element={<NewQuote />} />
        <Route path="/quotes/:id" element={<QuoteDetail />} />
        <Route path="/customers" element={<Customers />} />

        {/* 设置 */}
        <Route path="/settings" element={<Navigate to="/settings/config" replace />} />
        <Route path="/settings/config" element={<ConfigCenter />} />
        <Route path="/settings/materials" element={<Materials />} />
        <Route path="/settings/team" element={<Admin />} />
        {/* 平台管理：跨租户用户/企业（仅平台超管，后端二次校验） */}
        <Route path="/platform" element={<PlatformAdmin />} />

        {/* 旧地址兼容，避免老书签失效 */}
        <Route path="/admin" element={<Navigate to="/settings/team" replace />} />
        <Route path="/settings/quote-items" element={<Navigate to="/settings/config" replace />} />
        <Route path="/settings/parameters" element={<Navigate to="/settings/config" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
