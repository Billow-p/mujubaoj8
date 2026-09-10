import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { configApi, quotes } from '../api';
import { calculateConfigured } from '@mqs/calc-engine';
import type { QuoteItemDef } from '@mqs/shared';

const money = (n: number) => '¥ ' + Math.round(n || 0).toLocaleString('zh-CN');
/** 单件成本：保留小数 */
const money2 = (n: number) =>
  '¥ ' + (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export default function ConfiguredQuote() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();

  const [types, setTypes] = useState<any[]>([]);
  const [activeId, setActiveId] = useState('');
  const [cfg, setCfg] = useState<any | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [manuals, setManuals] = useState<Record<string, number>>({});
  const [customer, setCustomer] = useState({ name: '', email: '', productName: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 加载模具类型
  useEffect(() => {
    configApi.moldTypes().then((list: any[]) => {
      setTypes(list);
      if (!list.length) {
        setLoading(false);
        return;
      }
      const want = sp.get('type');
      const pick = list.find((t) => t.id === want) ?? list[0];
      setActiveId(pick.id);
    });
  }, []);

  // 加载配置
  useEffect(() => {
    if (!activeId) return;
    setLoading(true);
    configApi
      .get(activeId)
      .then((data: any) => {
        setCfg(data);
        const v: Record<string, any> = {};
        for (const p of data.parameters ?? []) {
          if (p.enabled === false) continue;
          v[p.name] = p.defaultValue ?? '';
        }
        setValues(v);
        setManuals({});
      })
      .finally(() => setLoading(false));
  }, [activeId]);

  // 实时算价
  const result = useMemo(() => {
    if (!cfg) return null;
    const params: Record<string, number> = {};
    for (const [k, val] of Object.entries(values)) {
      const n = Number(val);
      if (Number.isFinite(n)) params[k] = n;
    }
    const defs: QuoteItemDef[] = (cfg.items ?? []).map((it: any, i: number) => {
      const base: QuoteItemDef = {
        name: it.name,
        category: it.category,
        scope: it.scope,
        calcType: it.calcType,
        calcConfig: it.calcConfig ?? {},
        expression: it.expression,
        enabled: it.enabled !== false,
        sortOrder: it.sortOrder ?? i,
        perUnit: it.scope === 'injection' && it.perUnit === true,
      };
      const amt = manuals[it.name];
      if (it.calcType === 'manual' && amt != null) {
        return { ...base, calcType: 'fixed' as const, calcConfig: { amount: amt } };
      }
      return base;
    });
    return calculateConfigured(defs, params, {
      profitRate: cfg.moldType?.profitRate ?? 0.1,
      taxRate: cfg.moldType?.taxRate ?? 0.13,
    });
  }, [cfg, values, manuals]);

  const submit = async (sendEmail: boolean) => {
    if (!cfg) return;
    if (!customer.name.trim()) return alert('请填写客户名称');
    setSaving(true);
    try {
      const created = await quotes.createConfigured({
        moldTypeId: cfg.moldType.id,
        customerName: customer.name.trim(),
        customerEmail: customer.email.trim() || undefined,
        productName: customer.productName.trim() || undefined,
        values,
        manualAmounts: manuals,
      });
      if (sendEmail && customer.email.trim()) {
        await quotes.resendEmail(created.id, customer.email.trim());
      }
      navigate(`/quotes/${created.id}`);
    } catch (e: any) {
      alert('生成失败：' + (e.response?.data?.error || e.message));
    } finally {
      setSaving(false);
    }
  };

  if (!loading && types.length === 0) {
    return (
      <div className="max-w-3xl mx-auto p-10 text-center">
        <h1 className="text-lg font-semibold mb-2">还没有模具类型</h1>
        <p className="text-sm text-gray-500 mb-6">先到配置中心初始化模具类型，再回来报价</p>
        <button
          onClick={() => navigate('/settings/config')}
          className="bg-gray-900 text-white px-5 py-2.5 rounded text-sm"
        >
          去配置中心
        </button>
      </div>
    );
  }

  const params: any[] = (cfg?.parameters ?? []).filter((p: any) => p.enabled !== false);
  const manualItems: any[] = (cfg?.items ?? []).filter(
    (it: any) => it.enabled !== false && it.calcType === 'manual',
  );

  return (
    <div className="max-w-[1600px] mx-auto p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold">新建报价单</h1>
          <p className="text-sm text-gray-500 mt-1">
            选模具类型 → 填数据 → 价格自动出来 → 生成报价单
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => submit(false)}
            disabled={saving}
            className="border border-gray-300 px-4 py-2 rounded text-sm hover:bg-gray-50"
          >
            仅保存草稿
          </button>
          <button
            onClick={() => submit(true)}
            disabled={saving}
            className="bg-gray-900 text-white px-4 py-2 rounded text-sm font-medium hover:bg-gray-800"
          >
            {saving ? '生成中…' : customer.email ? '生成并发给客户' : '生成报价单'}
          </button>
        </div>
      </div>

      {/* 模具类型 */}
      <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 mb-4 flex items-center gap-3 flex-wrap">
        <span className="text-sm text-gray-500">模具类型</span>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 flex-wrap">
          {types.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveId(t.id)}
              className={`px-3 py-1.5 rounded text-[13px] whitespace-nowrap ${
                t.id === activeId ? 'bg-white font-medium shadow-sm' : 'text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={() => navigate('/settings/config')}
          className="text-xs text-gray-500 underline hover:text-gray-900"
        >
          去配置中心
        </button>
      </div>

      <div className="grid gap-3.5 items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) 380px' }}>
        {/* 左：填数据 */}
        <div className="space-y-3.5">
          <div className="bg-white border border-gray-200 rounded-lg">
            <div className="px-3.5 py-3 border-b border-gray-200 font-semibold text-sm">客户信息</div>
            <div className="p-3.5 grid grid-cols-3 gap-3">
              <label className="text-sm">
                <span className="text-gray-500">客户名称 *</span>
                <input
                  value={customer.name}
                  onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2.5 py-2 text-sm"
                  placeholder="如：顺德电器"
                />
              </label>
              <label className="text-sm">
                <span className="text-gray-500">客户邮箱（填了可直接发送）</span>
                <input
                  value={customer.email}
                  onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2.5 py-2 text-sm"
                  placeholder="buyer@example.com"
                />
              </label>
              <label className="text-sm">
                <span className="text-gray-500">项目 / 产品名称</span>
                <input
                  value={customer.productName}
                  onChange={(e) => setCustomer({ ...customer, productName: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2.5 py-2 text-sm"
                  placeholder="如：洗衣机控制面板"
                />
              </label>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg">
            <div className="px-3.5 py-3 border-b border-gray-200 flex items-center justify-between">
              <span className="font-semibold text-sm">
                {cfg?.moldType?.name ?? ''} · 产品数据
              </span>
              <span className="text-xs text-gray-400">改了价格立刻变</span>
            </div>
            <div className="p-3.5 grid grid-cols-3 gap-x-4 gap-y-3">
              {params.map((p) => {
                const opts: any[] = Array.isArray(p.options) ? p.options : [];
                const isSel = p.type === 'select' && opts.length > 0;
                return (
                  <label key={p.id ?? p.name} className="text-sm">
                    <span className="text-gray-500">
                      {p.name}
                      {p.unit && <span className="text-gray-400 text-xs"> ({p.unit})</span>}
                    </span>
                    {isSel ? (
                      <select
                        value={values[p.name] ?? ''}
                        onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}
                        className="mt-1 w-full border border-emerald-300 bg-emerald-50 text-emerald-900 rounded px-2.5 py-2 text-sm"
                      >
                        {opts.map((o, oi) => (
                          <option key={oi} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="number"
                        step="any"
                        value={values[p.name] ?? ''}
                        onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}
                        className="mt-1 w-full border border-gray-300 rounded px-2.5 py-2 text-sm text-right tabular-nums"
                      />
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          {manualItems.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg">
              <div className="px-3.5 py-3 border-b border-gray-200 font-semibold text-sm">
                需要你填写金额的费用
              </div>
              <div className="p-3.5 grid grid-cols-3 gap-x-4 gap-y-3">
                {manualItems.map((it) => (
                  <label key={it.id ?? it.name} className="text-sm">
                    <span className="text-gray-500">{it.name}（元）</span>
                    <input
                      type="number"
                      step="any"
                      value={manuals[it.name] ?? ''}
                      onChange={(e) => setManuals({ ...manuals, [it.name]: Number(e.target.value) })}
                      className="mt-1 w-full border border-gray-300 rounded px-2.5 py-2 text-sm text-right tabular-nums"
                      placeholder="0"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 右：算价 */}
        <div className="bg-white border border-gray-200 rounded-lg sticky top-4">
          <div className="px-3.5 py-3 border-b border-gray-200 font-semibold text-sm">实时算价</div>
          <div className="p-3.5 max-h-[420px] overflow-y-auto">
            {(result?.lines ?? []).map((l, i) => (
              <div key={i} className="py-2 border-b border-gray-50 last:border-0">
                <div className="flex justify-between items-baseline gap-2">
                  <span className={`text-[13.5px] ${l.skipped ? 'text-gray-400' : ''}`}>{l.name}</span>
                  <span className="text-[13.5px] font-semibold tabular-nums">
                    {l.error ? '—' : l.manual ? '待填' : money(l.value)}
                  </span>
                </div>
                {l.error ? (
                  <div className="text-[12.5px] text-red-600 mt-0.5">{l.error}</div>
                ) : (
                  <>
                    <div className="text-[12px] text-blue-700 mt-0.5">{l.readable}</div>
                    {l.scope === 'injection' && l.unitPrice != null && (
                      <div className="text-[12px] text-emerald-700 mt-0.5">
                        单件 {money2(l.unitPrice)}　×　{(l.qty ?? 0).toLocaleString('zh-CN')} 件
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            {(!result || result.lines.length === 0) && (
              <p className="text-center text-gray-400 text-sm py-6">该类型还没有费用项，先去配置中心加</p>
            )}
          </div>
          <div className="bg-gray-50 border-t border-gray-200 px-3.5 py-3">
            <div className="flex justify-between text-[13px] text-gray-600 py-0.5">
              <span>模具费用</span>
              <span>{money(result?.mold ?? 0)}</span>
            </div>
            <div className="flex justify-between text-[13px] text-gray-600 py-0.5 gap-2">
              <span className="min-w-0">
                注塑费用
                {result?.unitCost != null && result?.injectionQty != null && (
                  <span className="text-[11.5px] text-emerald-700 ml-1 whitespace-nowrap">
                    单件 {money2(result.unitCost)} × {result.injectionQty.toLocaleString('zh-CN')} 件
                  </span>
                )}
              </span>
              <span className="tabular-nums">{money(result?.injection ?? 0)}</span>
            </div>
            <div className="flex justify-between text-[13px] text-gray-600 py-0.5">
              <span>利润（{Math.round((result?.profitRate ?? 0) * 1000) / 10}%）</span>
              <span>{money(result?.profit ?? 0)}</span>
            </div>
            <div className="flex justify-between text-[13px] text-gray-600 py-0.5">
              <span>税额（{Math.round((result?.taxRate ?? 0) * 1000) / 10}%）</span>
              <span>{money(result?.tax ?? 0)}</span>
            </div>
            <div className="flex justify-between items-baseline pt-2 mt-1.5 border-t border-gray-200">
              <span className="text-[13.5px] font-semibold">含税总价</span>
              <b className="text-[21px]">{money(result?.total ?? 0)}</b>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
