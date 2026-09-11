import { useEffect, useState } from 'react';
import { platform } from '../api';

const money = (n: number | null | undefined) =>
  '¥ ' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });

const dt = (s?: string | null) => (s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '—');
const dateOnly = (s?: string | null) => (s ? new Date(s).toLocaleDateString('zh-CN') : '—');

const ROLE: Record<string, { label: string; cls: string }> = {
  admin: { label: '管理员', cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  auditor: { label: '审核员', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  quoter: { label: '报价员', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
};

const PAGE_SIZE = 20;

/**
 * 平台管理（SaaS 运营方视角）
 *
 * 与「设置 → 团队与数据」的区别：
 *   团队与数据 = 公司内管理员，仅本公司
 *   平台管理   = 平台超管，跨所有公司查看全部注册用户
 */
export default function PlatformAdmin() {
  const [tab, setTab] = useState<'users' | 'companies'>('users');
  const [overview, setOverview] = useState<any>(null);
  const [data, setData] = useState<any>(null);
  const [companies, setCompanies] = useState<any[]>([]);
  const [keyword, setKeyword] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [page, setPage] = useState(1);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  // 概览只加载一次
  useEffect(() => {
    platform
      .overview()
      .then(setOverview)
      .catch((e) => setErr(e?.response?.data?.error || '加载失败'));
  }, []);

  // 用户列表（关键词 / 公司 / 分页变化时重新拉）
  useEffect(() => {
    setLoading(true);
    platform
      .users({
        keyword: keyword.trim() || undefined,
        companyId: companyId || undefined,
        page,
        pageSize: PAGE_SIZE,
      })
      .then(setData)
      .catch((e) => setErr(e?.response?.data?.error || '加载失败'))
      .finally(() => setLoading(false));
  }, [keyword, companyId, page]);

  // 公司列表（切到公司 Tab 时拉）
  useEffect(() => {
    if (tab !== 'companies') return;
    platform
      .companies({ keyword: keyword.trim() || undefined })
      .then(setCompanies)
      .catch((e) => setErr(e?.response?.data?.error || '加载失败'));
  }, [tab, keyword]);

  if (err) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="bg-white border border-gray-200 rounded p-8 text-center">
          <div className="text-gray-900 font-medium mb-1">无法访问平台管理</div>
          <div className="text-sm text-gray-500">{err}</div>
        </div>
      </div>
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const cards = overview
    ? [
        { label: '注册企业', value: overview.counts.companies, sub: '租户总数' },
        { label: '注册用户', value: overview.counts.users, sub: `近 30 天 +${overview.recent30.users}` },
        { label: '客户总数', value: overview.counts.customers, sub: '平台累计' },
        { label: '报价单总数', value: overview.counts.quotes, sub: `近 30 天 +${overview.recent30.quotes}` },
      ]
    : [];

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">平台管理</h1>
        <p className="text-[13px] text-gray-500 mt-0.5">
          跨企业查看全部注册用户与租户数据（仅平台超管可见）
        </p>
      </div>

      {/* 概览 */}
      {cards.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {cards.map((c) => (
            <div key={c.label} className="bg-white border border-gray-200 rounded p-4">
              <div className="text-[12px] text-gray-500">{c.label}</div>
              <div className="mt-1 font-semibold text-gray-900 tabular-nums text-2xl">{c.value}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">{c.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* 角色分布 */}
      {overview?.byRole?.length > 0 && (
        <div className="bg-white border border-gray-200 rounded p-4">
          <div className="text-sm font-medium text-gray-900 mb-3">用户角色分布</div>
          <div className="flex flex-wrap gap-2">
            {overview.byRole.map((r: any) => (
              <div key={r.role} className="flex items-center gap-2 border border-gray-200 rounded px-3 py-1.5">
                <span className="text-[12.5px] text-gray-600">{r.label}</span>
                <span className="text-[13px] font-semibold text-gray-900 tabular-nums">{r.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab + 搜索 */}
      <div className="bg-white border border-gray-200 rounded">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            {(['users', 'companies'] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  setPage(1);
                }}
                className={`px-3 py-1.5 rounded text-[13px] whitespace-nowrap ${
                  tab === t ? 'bg-white font-medium shadow-sm' : 'text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t === 'users' ? '全部用户' : '企业（租户）'}
              </button>
            ))}
          </div>

          <input
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
            placeholder={tab === 'users' ? '搜索邮箱 / 姓名 / 企业名' : '搜索企业名'}
            className="border border-gray-300 rounded px-2.5 py-1.5 text-sm w-64"
          />

          {tab === 'users' && (
            <select
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setPage(1);
              }}
              className="border border-gray-300 rounded px-2.5 py-1.5 text-sm"
            >
              <option value="">全部企业</option>
              {(overview?.companies ?? []).map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}

          <div className="flex-1" />
          {tab === 'users' && data && (
            <span className="text-[12px] text-gray-400">
              共 {data.total} 人 · 第 {page}/{totalPages} 页
            </span>
          )}
          {tab === 'companies' && (
            <span className="text-[12px] text-gray-400">共 {companies.length} 家</span>
          )}
        </div>

        {/* 用户表 */}
        {tab === 'users' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[12px] text-gray-500">
                <tr>
                  <th className="text-left px-5 py-2.5 font-normal">姓名 / 邮箱</th>
                  <th className="text-left px-3 py-2.5 font-normal">所属企业</th>
                  <th className="text-left px-3 py-2.5 font-normal">角色</th>
                  <th className="text-left px-3 py-2.5 font-normal">邮箱验证</th>
                  <th className="text-left px-3 py-2.5 font-normal">注册时间</th>
                  <th className="text-left px-3 py-2.5 font-normal">最后登录</th>
                  <th className="text-right px-3 py-2.5 font-normal">报价单</th>
                  <th className="text-right px-5 py-2.5 font-normal">累计金额</th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).map((u: any) => {
                  const r = ROLE[u.role] ?? { label: u.role, cls: 'bg-gray-100 text-gray-600 border-gray-200' };
                  return (
                    <tr key={u.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-5 py-2.5">
                        <div className="text-gray-900 flex items-center gap-1.5">
                          {u.name}
                          {u.isSuperAdmin && (
                            <span className="text-[10.5px] border rounded px-1 py-0.5 bg-rose-50 text-rose-700 border-rose-200">
                              超管
                            </span>
                          )}
                        </div>
                        <div className="text-[11.5px] text-gray-400">{u.email}</div>
                      </td>
                      <td className="px-3 py-2.5 text-[12.5px] text-gray-700">{u.company?.name || '—'}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[11.5px] border rounded px-1.5 py-0.5 ${r.cls}`}>{r.label}</span>
                      </td>
                      <td className="px-3 py-2.5 text-[12.5px]">
                        {u.emailVerified ? (
                          <span className="text-green-600">已验证</span>
                        ) : (
                          <span className="text-gray-400">未验证</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[12.5px] text-gray-600">{dt(u.createdAt)}</td>
                      <td className="px-3 py-2.5 text-[12.5px] text-gray-600">{dt(u.lastLoginAt)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-900">{u.stats.quotes}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-gray-900">
                        {money(u.stats.amount)}
                      </td>
                    </tr>
                  );
                })}
                {!loading && (data?.items ?? []).length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-5 py-8 text-center text-sm text-gray-400">
                      没有匹配的用户
                    </td>
                  </tr>
                )}
                {loading && (
                  <tr>
                    <td colSpan={8} className="px-5 py-8 text-center text-sm text-gray-400">
                      加载中…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 py-3 border-t border-gray-100">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="border border-gray-300 rounded px-3 py-1 text-[13px] disabled:opacity-40"
                >
                  上一页
                </button>
                <span className="text-[13px] text-gray-600 tabular-nums">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="border border-gray-300 rounded px-3 py-1 text-[13px] disabled:opacity-40"
                >
                  下一页
                </button>
              </div>
            )}
          </div>
        )}

        {/* 公司表 */}
        {tab === 'companies' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[12px] text-gray-500">
                <tr>
                  <th className="text-left px-5 py-2.5 font-normal">企业名称</th>
                  <th className="text-left px-3 py-2.5 font-normal">企业 ID</th>
                  <th className="text-right px-3 py-2.5 font-normal">用户数</th>
                  <th className="text-right px-3 py-2.5 font-normal">客户数</th>
                  <th className="text-right px-3 py-2.5 font-normal">报价单</th>
                  <th className="text-left px-5 py-2.5 font-normal">注册时间</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-5 py-2.5 text-gray-900">{c.name}</td>
                    <td className="px-3 py-2.5 text-[11.5px] text-gray-400 font-mono">{c.id}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-900">{c.users}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-900">{c.customers}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-900">{c.quotes}</td>
                    <td className="px-5 py-2.5 text-[12.5px] text-gray-600">{dateOnly(c.createdAt)}</td>
                  </tr>
                ))}
                {companies.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-sm text-gray-400">
                      暂无企业
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
