import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../store';

export default function Layout() {
  const { user, setUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const logout = () => {
    localStorage.removeItem('mqs_token');
    setUser(null);
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded bg-gray-900 text-white flex items-center justify-center text-xs font-bold">M</div>
              <span className="font-semibold text-sm">模具注塑报价系统</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link
                to="/"
                className={`px-3 py-1.5 rounded ${location.pathname === '/' ? 'bg-gray-900 text-white' : 'hover:bg-gray-100'}`}
              >
                工作台
              </Link>
              <Link
                to="/quotes/new"
                className={`px-3 py-1.5 rounded ${location.pathname === '/quotes/new' ? 'bg-gray-900 text-white' : 'hover:bg-gray-100'}`}
              >
                新建报价单
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-600">{user?.name}</span>
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{user?.role}</span>
            <button onClick={logout} className="text-xs text-gray-600 hover:text-gray-900">
              登出
            </button>
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
