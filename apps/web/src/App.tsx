import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import NewQuote from './pages/NewQuote';
import QuoteDetail from './pages/QuoteDetail';
import Customers from './pages/Customers';
import QuoteItems from './pages/QuoteItems';
import Materials from './pages/Materials';
import Parameters from './pages/Parameters';
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
        <Route path="/quotes/:id" element={<QuoteDetail />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/settings/quote-items" element={<QuoteItems />} />
        <Route path="/settings/materials" element={<Materials />} />
        <Route path="/settings/parameters" element={<Parameters />} />
      </Route>
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
