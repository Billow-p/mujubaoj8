import { useEffect, useState } from 'react';
import { admin } from '../api';

const money = (n: number | null | undefined) =>
  '¥ ' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });

const dt = (s?: string | null) => (s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '—');

/** 只要年月日 —— 不能用 dt().slice()，中文日期长度不固定会截错 */
const dateOnly = (s?: string | null) => (s ? new Date(s).toLocaleDateString('zh-CN') : '—');

const ROLE: Record<string, { label: string; cls: string }> = {
  admin: { label: '管理员', cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  auditor: { label: '审核员', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  quoter: { label: '报价员', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
};

/**
 * 后台管理 —— 用户注册信息与业务数据
 *
 * 仅管理员可见（后端也会再校验一次 role；前端隐藏导航只是体验优化，不是安全边界）。
 */
export default function Admin() {
  const [overview, setOverview] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([admin.overview(), admin.users()])
      .then(([o, u]) => {
        setOverview(o);
        setUsers(u);
      })
      .catch((e) => setErr(e?.response?.data?.error || '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-sm text-gray-400 py-10 text-center">正在加载…</div>;
  }

  if (err) {
    return (
      <div className="bg-white border border-gray-200 rounded p-8 text-center">
        <div className="text-gray-900 font-medium mb-1">无法访问后台管理</div>
        <div className="text-sm text-gray-500">{err}</div>
      </div>
    );
  }

  const c = overview.counts;

  const cards = [
    { label: '用户数', value: c.users, sub: `近 30 天 +${overview.recent30.users}` },
    { label: '客户数', value: c.customers, sub: '累计入库' },
    { label: '报价单数', value: c.quotes, sub: `近 30 天 +${overview.recent30.quotes}` },
    { label: '累计报价金额', value: money(overview.amount.total), sub: '含税', wide: true },
    { label: '已成交金额', value: money(overview.amount.confirmed), sub: '含税', wide: true },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">后台管理</h1>
        <p className="text-[13px] text-gray-500 mt-0.5">
          {overview.company?.name || '本公司'} · 注册于 {dateOnly(overview.company?.createdAt)}
          {overview.amount.basedOn > 0 && (
            <span className="text-gray-400"> · 金额统计基于最近 {overview.amount.basedOn} 张报价单</span>
          )}
        </p>
      </div>

      {/* 概览卡片 */}
      <div className="grid grid-cols-5 gap-3">
        {cards.map((cd) => (
          <div key={cd.label} className="bg-white border border-gray-200 rounded p-4">
            <div className="text-[12px] text-gray-500">{cd.label}</div>
            <div className={`mt-1 font-semibold text-gray-900 tabular-nums ${cd.wide ? 'text-[17px]' : 'text-2xl'}`}>
              {cd.value}
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5">{cd.sub}</div>
          </div>
        ))}
      </div>

      {/* 状态分布 */}
      {overview.byStatus?.length > 0 && (
        <div className="bg-white border border-gray-200 rounded p-4">
          <div className="text-sm font-medium text-gray-900 mb-3">报价单状态分布</div>
          <div className="flex flex-wrap gap-2">
            {overview.byStatus.map((s: any) => (
              <div key={s.status} className="flex items-center gap-2 border border-gray-200 rounded px-3 py-1.5">
                <span className="text-[12.5px] text-gray-600">{s.label}</span>
                <span className="text-[13px] font-semibold text-gray-900 tabular-nums">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 用户表 */}
      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-900">用户列表</span>
          <span className="text-[12px] text-gray-400">共 {users.length} 人</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[12px] text-gray-500">
              <tr>
                <th className="text-left px-5 py-2.5 font-normal">姓名 / 邮箱</th>
                <th className="text-left px-3 py-2.5 font-normal">角色</th>
                <th className="text-left px-3 py-2.5 font-normal">邮箱验证</th>
                <th className="text-left px-3 py-2.5 font-normal">注册时间</th>
                <th className="text-left px-3 py-2.5 font-normal">最后登录</th>
                <th className="text-right px-3 py-2.5 font-normal">报价单</th>
                <th className="text-right px-3 py-2.5 font-normal">累计金额</th>
                <th className="text-right px-5 py-2.5 font-normal">已成交</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const r = ROLE[u.role] ?? { label: u.role, cls: 'bg-gray-100 text-gray-600 border-gray-200' };
                return (
                  <tr key={u.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-5 py-2.5">
                      <div className="text-gray-900">{u.name}</div>
                      <div className="text-[11.5px] text-gray-400">{u.email}</div>
                    </td>
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
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-900">{money(u.stats.amount)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-gray-600">
                      {money(u.stats.confirmedAmount)}
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-sm text-gray-400">
                    暂无用户
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
