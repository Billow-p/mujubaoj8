import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../api';
import { useAuth } from '../store';

type Mode = 'login' | 'register' | 'forgot';

export default function Login() {
  const navigate = useNavigate();
  const setUser = useAuth((s) => s.setUser);
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  // 验证码倒计时
  const [countdown, setCountdown] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startCountdown = (sec: number) => {
    setCountdown(sec);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const handleSendCode = async () => {
    if (!email) {
      setError('请先填写邮箱');
      return;
    }
    const scene = mode === 'register' ? 'register' : 'reset_password';
    setError('');
    setSuccess('');
    setSendingCode(true);
    try {
      const res = await auth.sendCode(email, scene);
      setSuccess(res.message || '验证码已发送');
      startCountdown(res.expiresInSec ? 60 : 60);
    } catch (err: any) {
      setError(err.response?.data?.error || '验证码发送失败');
    } finally {
      setSendingCode(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      if (mode === 'login') {
        const data = await auth.login(email, password);
        localStorage.setItem('mqs_token', data.token);
        setUser(data.user);
        navigate('/');
      } else if (mode === 'register') {
        const data = await auth.register({
          email,
          password,
          name,
          code,
          companyName: companyName || undefined,
        });
        localStorage.setItem('mqs_token', data.token);
        setUser(data.user);
        navigate('/');
      } else {
        // 找回密码
        const res = await auth.resetPassword(email, code, password);
        setSuccess(res.message || '密码重置成功');
        setMode('login');
        setCode('');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
    setSuccess('');
    setCode('');
    setCountdown(0);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const needsCode = mode === 'register' || mode === 'forgot';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-lg p-8 shadow-sm">
        <div className="text-center mb-6">
          <div className="w-12 h-12 mx-auto rounded bg-gray-900 text-white flex items-center justify-center text-lg font-bold mb-3">
            M
          </div>
          <h1 className="text-xl font-semibold">模具注塑报价系统</h1>
          <p className="text-sm text-gray-500 mt-1">
            {mode === 'login' ? '邮箱登录' : mode === 'register' ? '邮箱验证码注册' : '邮箱验证码找回密码'}
          </p>
        </div>

        <div className="flex border-b border-gray-200 mb-5 -mx-8 px-8">
          <button
            onClick={() => switchMode('login')}
            className={`flex-1 py-2 text-sm font-medium border-b-2 -mb-px ${
              mode === 'login' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500'
            }`}
          >
            登录
          </button>
          <button
            onClick={() => switchMode('register')}
            className={`flex-1 py-2 text-sm font-medium border-b-2 -mb-px ${
              mode === 'register' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500'
            }`}
          >
            注册
          </button>
          <button
            onClick={() => switchMode('forgot')}
            className={`flex-1 py-2 text-sm font-medium border-b-2 -mb-px ${
              mode === 'forgot' ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500'
            }`}
          >
            找回密码
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
            <label className="text-xs text-gray-600 block mb-1">邮箱</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={mode === 'login' ? '' : '请输入邮箱接收验证码'}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
            />
          </div>

          {needsCode && (
            <div>
              <label className="text-xs text-gray-600 block mb-1">邮箱验证码</label>
              <div className="flex gap-2">
                <input
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6 位数字"
                  maxLength={6}
                  className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm tracking-[0.3em] font-mono focus:border-gray-900 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={countdown > 0 || sendingCode || !email}
                  className="shrink-0 px-3 py-2 border border-gray-300 rounded text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {sendingCode ? '发送中' : countdown > 0 ? `${countdown}s` : '获取验证码'}
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-gray-600 block mb-1">
              {mode === 'forgot' ? '新密码' : '密码'}
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'login' ? '' : '至少 6 位'}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:border-gray-900 focus:outline-none"
            />
          </div>

          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded px-3 py-2">{error}</div>}
          {success && (
            <div className="text-xs text-green-700 bg-green-50 border border-green-100 rounded px-3 py-2">
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gray-900 text-white py-2.5 rounded text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {loading
              ? '处理中...'
              : mode === 'login'
                ? '登录'
                : mode === 'register'
                  ? '注册'
                  : '重置密码'}
          </button>
        </form>
      </div>
    </div>
  );
}
