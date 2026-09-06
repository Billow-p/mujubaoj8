import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../api';
import { useAuth } from '../store';

export default function Login() {
  const navigate = useNavigate();
  const setUser = useAuth((s) => s.setUser);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('quoter@mqs.local');
  const [password, setPassword] = useState('password123');
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data =
        mode === 'login'
          ? await auth.login(email, password)
          : await auth.register({ email, password, name, companyName: companyName || undefined });
      localStorage.setItem('mqs_token', data.token);
      setUser(data.user);
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.error || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-lg p-8 shadow-sm">
        <div className="text-center mb-6">
          <div className="w-12 h-12 mx-auto rounded bg-gray-900 text-white flex items-center justify-center text-lg font-bold mb-3">M</div>
          <h1 className="text-xl font-semibold">模具注塑报价系统</h1>
          <p className="text-sm text-gray-500 mt-1">{mode === 'login' ? '企业邮箱登录' : '企业邮箱注册'}</p>
        </div>

        <div className="flex border-b border-gray-200 mb-5 -mx-8 px-8">
          <button
            onClick={() => setMode('login')}
            className={`flex-1 py-2 text-sm font-medium border-b-2 -mb-px ${mode === 'login' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500'}`}
          >
            登录
          </button>
          <button
            onClick={() => setMode('register')}
            className={`flex-1 py-2 text-sm font-medium border-b-2 -mb-px ${mode === 'register' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500'}`}
          >
            注册
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === 'register' && (
            <>
              <div>
                <label className="text-xs text-gray-600 block mb-1">姓名</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">企业名称（可选）</label>
                <input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
                />
              </div>
            </>
          )}
          <div>
            <label className="text-xs text-gray-600 block mb-1">企业邮箱</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">密码</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
            />
          </div>
          {error && <div className="text-xs text-red-600">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gray-900 text-white py-2.5 rounded text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? '处理中...' : mode === 'login' ? '登录' : '注册'}
          </button>
        </form>

        <div className="mt-6 text-xs text-gray-400 text-center space-y-1">
          <div>测试账号：quoter@mqs.local / auditor@mqs.local / admin@mqs.local</div>
          <div>密码：password123</div>
        </div>
      </div>
    </div>
  );
}
