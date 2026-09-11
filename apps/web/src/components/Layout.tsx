import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../store';

type NavItem = {
  to: string;
  label: string;
  exact?: boolean;
  adminOnly?: boolean;
  /** 仅平台超管可见（跨租户管理） */
  superOnly?: boolean;
  /** 用前缀匹配高亮（「设置」要覆盖所有 /settings/*） */
  matchPrefix?: string;
};

/**
 * 主导航：只放「用户要做什么」，按使用频率从高到低。
 *
 * 「新建报价单」刻意不在这里 —— 它是一个动作，放在了报价单列表页右上角。
 * 配置类（报价配置 / 材料库 / 条款 / 团队）全部收进「设置」，进去后是二级导航。
 */
const NAV: NavItem[] = [
  { to: '/', label: '报价单', exact: true },
  { to: '/customers', label: '客户' },
  { to: '/settings/config', label: '设置', matchPrefix: '/settings' },
  { to: '/platform', label: '平台管理', superOnly: true },
];

/** 设置区的二级导航：低频的配置与管理都收在这里 */
const SETTINGS_TABS: NavItem[] = [
  { to: '/settings/config', label: '计价规则' },
  { to: '/settings/materials', label: '材料库' },
  { to: '/settings/team', label: '团队与数据', adminOnly: true },
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

  const isAdmin = user?.role === 'admin';
  const isSuperAdmin = !!user?.isSuperAdmin;
  const inSettings = location.pathname.startsWith('/settings');

  const logout = () => {
    localStorage.removeItem('mqs_token');
    setUser(null);
    navigate('/login');
  };

  const active = (item: NavItem) => {
    if (item.matchPrefix) return location.pathname.startsWith(item.matchPrefix);
    return item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);
  };

  const visible = (list: NavItem[]) =>
    list.filter((i) => (!i.adminOnly || isAdmin) && (!i.superOnly || isSuperAdmin));

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
              {visible(NAV).map((item) => (
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
            {isSuperAdmin && (
              <span className="text-xs text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded">
                平台超管
              </span>
            )}
            <button onClick={logout} className="text-xs text-gray-600 hover:text-gray-900">
              登出
            </button>
          </div>
        </div>
      </header>

      {/* 设置区的二级导航 */}
      {inSettings && (
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-6 h-11 flex items-center gap-1 text-[13px]">
            <span className="text-gray-400 mr-2">设置</span>
            {visible(SETTINGS_TABS).map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`px-3 py-1 rounded whitespace-nowrap ${
                  location.pathname === item.to
                    ? 'bg-gray-100 font-medium text-gray-900'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      <main>
        <Outlet />
      </main>
    </div>
  );
}
