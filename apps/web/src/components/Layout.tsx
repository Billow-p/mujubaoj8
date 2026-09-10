import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../store';

type NavItem = { to: string; label: string; exact?: boolean; adminOnly?: boolean };

const NAV: NavItem[] = [
  { to: '/', label: '工作台', exact: true },
  { to: '/quotes/new', label: '新建报价单' },
  { to: '/customers', label: '客户库' },
  { to: '/settings/config', label: '配置中心' },
  { to: '/settings/materials', label: '材料中心' },
  { to: '/settings/quote-items', label: '报价项中心' },
  // 参数中心已下线：参数在「配置中心 → 产品数据」里就地增删改，功能零损失
  { to: '/admin', label: '后台管理', adminOnly: true },
];

const ROLE_LABEL: Record<string, string> = {
  admin: '管理员',
  auditor: '审核员',
  quoter: '报价员',
};

export default function Layout() {
  const { user, setUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const logout = () => {
    localStorage.removeItem('mqs_token');
    setUser(null);
    navigate('/login');
  };

  const active = (item: (typeof NAV)[number]) =>
    item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);

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
              {NAV.filter((item) => !item.adminOnly || user?.role === 'admin').map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`px-3 py-1.5 rounded whitespace-nowrap ${
                    active(item) ? 'bg-gray-900 text-white' : 'hover:bg-gray-100'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-600">{user?.name}</span>
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
              {ROLE_LABEL[user?.role ?? ''] ?? user?.role}
            </span>
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
