// 新建报价单 — 核心页面
// 实时计算（前端用 @mqs/calc-engine）+ 保存（调后端）

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { calculateQuote, validateQuoteInput, compareOptimalCavity } from '@mqs/calc-engine';
import type { QuoteInput, QuoteCalcResult, CavityComparison } from '@mqs/calc-engine';
import { calc, quotes } from '../api';

const DEFAULT_INPUT: QuoteInput = {
  customerName: '',
  productName: '',
  material: 'ABS',
  steel: 'P20',
  complexity: 'medium',
  singleWeightKg: 0.18,
  cavityCount: 2,
  cycleTimeS: 45,
  efficiencyFactor: 0.8,
  firstOrderQty: 300000,
  machineRatePerHour: 130,
  materialLossRate: 0.05,
  vatRate: 0.13,
  managementRate: 0.15,
  coreLengthMm: 500,
  coreWidthMm: 400,
  coreHeightMm: 150,
  steelDensity: 7.85,
  steelUnitPrice: 25,
  postProcessType: '去飞边/装箱',
};

export default function NewQuote() {
  const navigate = useNavigate();
  const [input, setInput] = useState<QuoteInput>(DEFAULT_INPUT);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [locks, setLocks] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [cavityComparison, setCavityComparison] = useState<CavityComparison[] | null>(null);

  const update = <K extends keyof QuoteInput>(k: K, v: QuoteInput[K]) => {
    setInput((prev) => ({ ...prev, [k]: v }));
    // 改动参数时清空覆盖和锁定
    if (overrides[overridesKeyForInput(k)]) {
      const nk = overridesKeyForInput(k);
      const next = { ...overrides };
      delete next[nk];
      setOverrides(next);
    }
  };

  const overridesKeyForInput = (k: keyof QuoteInput): string => {
    // 这里简化：input 变化不直接清覆盖，由后端重算时识别
    return '';
  };

  const setOverride = (key: string, value: number) => {
    const next = { ...overrides, [key]: value };
    setOverrides(next);
  };

  const toggleLock = (key: string) => {
    const next = new Set(locks);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setLocks(next);
  };

  // 实时计算
  const result: QuoteCalcResult | { error: string } = useMemo(() => {
    const errors = validateQuoteInput(input);
    if (errors.length > 0) return { error: errors.map((e) => e.field + ': ' + e.message).join('；') };
    try {
      return calculateQuote({
        input,
        overrides,
        locks: Array.from(locks) as any,
      });
    } catch (e: any) {
      return { error: e.message };
    }
  }, [input, overrides, locks]);

  const isError = 'error' in result;
  const r = isError ? null : (result as QuoteCalcResult);

  const runCavityComparison = async () => {
    try {
      const cmp = await calc.cavity(input);
      setCavityComparison(cmp);
    } catch (e: any) {
      alert('腔数对比失败：' + (e.response?.data?.error || e.message));
    }
  };

  const save = async (submitForReview: boolean) => {
    if (isError) {
      setError('请先修正参数错误');
      return;
    }
    setError('');
    setSaving(true);
    try {
      // 1. 先调后端计算（权威）
      const calcResult = await calc.quote({
        input,
        overrides,
        locks: Array.from(locks),
      });
      // 2. 保存草稿
      const created = await quotes.create({
        customerName: input.customerName,
        input,
        overrides,
        locks: Array.from(locks),
        businessTermOverrides: calcResult.businessTerms,
      });
      // 3. 如要提交审核
      if (submitForReview) {
        await quotes.submit(created.id);
      }
      navigate('/');
    } catch (e: any) {
      setError(e.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-5">
      {/* 顶部 */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 flex items-center justify-between">
        <h1 className="text-lg font-semibold">新建报价单</h1>
        <div className="flex gap-2">
          <button
            onClick={() => save(false)}
            disabled={saving}
            className="text-xs border border-gray-300 px-3 py-1.5 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存草稿'}
          </button>
          <button
            onClick={() => save(true)}
            disabled={saving}
            className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded hover:bg-gray-800 disabled:opacity-50"
          >
            提交审核
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">{error}</div>
      )}

      {/* ① 客户 */}
      <Section title="① 客户与产品">
        <div className="grid grid-cols-4 gap-4">
          <Field label="客户名称 *" value={input.customerName} onChange={(v) => update('customerName', v)} />
          <Field label="产品名称 *" value={input.productName} onChange={(v) => update('productName', v)} />
          <SelectField label="产品材质 *" value={input.material} options={['ABS', 'PP', 'PE', 'PA', 'PC', 'POM', 'PMMA', 'PBT']} onChange={(v) => update('material', v as any)} />
          <SelectField label="模具钢材 *" value={input.steel} options={['P20', '718H', 'S136', 'NAK80', 'H13', 'S50C']} onChange={(v) => update('steel', v as any)} />
          <SelectField label="产品复杂度 *" value={input.complexity} options={[
            ['simple', '简单 (0.7)'], ['medium', '中等 (1.0)'], ['complex', '复杂 (1.5)'], ['ultra_precision', '超精密 (2.5)'],
          ]} onChange={(v) => update('complexity', v as any)} />
          <NumField label="单件重量 (kg) *" value={input.singleWeightKg} step={0.01} onChange={(v) => update('singleWeightKg', v)} />
          <NumField label="首单数量 (件) *" value={input.firstOrderQty} onChange={(v) => update('firstOrderQty', v)} />
          <NumField label="模具腔数 *" value={input.cavityCount} min={1} max={16} onChange={(v) => update('cavityCount', v)} />
        </div>
      </Section>

      {/* ② 注塑工艺 */}
      <Section title="② 注塑工艺参数">
        <div className="grid grid-cols-4 gap-4">
          <NumField label="成型周期 (秒) *" value={input.cycleTimeS} onChange={(v) => update('cycleTimeS', v)} />
          <NumField label="效率系数" value={input.efficiencyFactor} step={0.05} min={0.1} max={1} onChange={(v) => update('efficiencyFactor', v)} />
          <NumField label="机台小时费率 (元/h)" value={input.machineRatePerHour} onChange={(v) => update('machineRatePerHour', v)} />
          <NumField label="材料损耗率" value={input.materialLossRate} step={0.01} min={0} max={0.5} onChange={(v) => update('materialLossRate', v)} />
          <NumField label="增值税率" value={input.vatRate} step={0.01} min={0} max={0.3} onChange={(v) => update('vatRate', v)} />
          <NumField label="管理费率" value={input.managementRate} step={0.01} min={0} max={0.5} onChange={(v) => update('managementRate', v)} />
          <SelectField label="后加工类型" value={input.postProcessType} options={['去飞边/装箱', '去飞边', '喷涂', '丝印', '超声波焊接']} onChange={(v) => update('postProcessType', v)} />
        </div>
      </Section>

      {/* ③ 模芯尺寸 */}
      <Section title="③ 模芯尺寸">
        <div className="grid grid-cols-5 gap-4">
          <NumField label="长度 (mm)" value={input.coreLengthMm} onChange={(v) => update('coreLengthMm', v)} />
          <NumField label="宽度 (mm)" value={input.coreWidthMm} onChange={(v) => update('coreWidthMm', v)} />
          <NumField label="高度 (mm)" value={input.coreHeightMm} onChange={(v) => update('coreHeightMm', v)} />
          <NumField label="钢料密度 (g/cm³)" value={input.steelDensity} step={0.05} onChange={(v) => update('steelDensity', v)} />
          <NumField label="钢料单价 (元/kg)" value={input.steelUnitPrice} step={0.5} onChange={(v) => update('steelUnitPrice', v)} />
        </div>
      </Section>

      {/* ④ 模具费 */}
      {r && (
        <Section title="④ 模具费明细（动态算 + 可覆盖 + 可锁定）">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-600 border-b border-gray-200">
              <tr>
                <th className="text-left py-2 w-10">#</th>
                <th className="text-left py-2 w-32">项目</th>
                <th className="text-left py-2">计算依据</th>
                <th className="text-right py-2 w-32">金额</th>
                <th className="text-center py-2 w-16">锁定</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {MOLD_FEE_ROWS.map((row, i) => {
                const item = r.moldFeeItems[row.key];
                const isOverridden = item.overridden || item.locked;
                return (
                  <tr key={row.key} className={isOverridden ? 'bg-yellow-50' : ''}>
                    <td className="py-2">{i + 1}</td>
                    <td className="py-2 font-medium">{row.label}</td>
                    <td className="py-2 font-mono text-xs text-gray-500">{item.formula}</td>
                    <td className="py-2 text-right">
                      <OverrideCell
                        value={item.value}
                        locked={item.locked}
                        onChange={(v) => setOverride(row.key, v)}
                      />
                    </td>
                    <td className="py-2 text-center">
                      <input
                        type="checkbox"
                        checked={item.locked}
                        onChange={() => toggleLock(row.key)}
                        disabled={!item.overridden}
                      />
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-gray-50">
                <td className="py-2">12</td>
                <td className="py-2 font-medium">小计</td>
                <td className="py-2 font-mono text-xs text-gray-500">SUM(1~11)</td>
                <td className="py-2 text-right font-semibold">¥ {r.summary.moldSubtotal.toLocaleString()}</td>
                <td></td>
              </tr>
              <tr>
                <td className="py-2">13</td>
                <td className="py-2 font-medium">管理费 + 利润</td>
                <td className="py-2 font-mono text-xs text-gray-500">小计 × 管理费率</td>
                <td className="py-2 text-right">¥ {r.summary.moldManagementFee.toLocaleString()}</td>
                <td></td>
              </tr>
              <tr className="bg-gray-100">
                <td className="py-2">14</td>
                <td className="py-2 font-semibold">模具合计（不含税）</td>
                <td className="py-2 font-mono text-xs text-gray-500">小计 + 管理费</td>
                <td className="py-2 text-right text-base font-bold">¥ {r.summary.moldTotalExVat.toLocaleString()}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </Section>
      )}

      {/* ⑤ 注塑单件 */}
      {r && (
        <Section title="⑤ 注塑单件成本">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-600 border-b border-gray-200">
              <tr>
                <th className="text-left py-2 w-10">#</th>
                <th className="text-left py-2 w-32">项目</th>
                <th className="text-left py-2">计算依据</th>
                <th className="text-right py-2 w-32">单价(元/件)</th>
                <th className="text-center py-2 w-16">锁定</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {INJECTION_ROWS.map((row, i) => {
                const item = r.injectionItems[row.key];
                const isOverridden = item.overridden || item.locked;
                return (
                  <tr key={row.key} className={isOverridden ? 'bg-yellow-50' : ''}>
                    <td className="py-2">{i + 1}</td>
                    <td className="py-2 font-medium">{row.label}</td>
                    <td className="py-2 font-mono text-xs text-gray-500">{item.formula}</td>
                    <td className="py-2 text-right">
                      <OverrideCell
                        value={item.value}
                        locked={item.locked}
                        onChange={(v) => setOverride(row.key, v)}
                      />
                    </td>
                    <td className="py-2 text-center">
                      <input
                        type="checkbox"
                        checked={item.locked}
                        onChange={() => toggleLock(row.key)}
                        disabled={!item.overridden}
                      />
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-gray-50">
                <td className="py-2"></td>
                <td className="py-2 font-semibold">单件成本小计</td>
                <td className="py-2 font-mono text-xs text-gray-500">SUM(1~5)</td>
                <td className="py-2 text-right text-base font-bold">¥ {r.summary.unitCostExVat.toFixed(2)} /件</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </Section>
      )}

      {/* ⑥ 汇总 */}
      {r && (
        <Section title="⑥ 含税报价汇总">
          <div className="grid grid-cols-3 gap-4">
            <SummaryCard label="模具费（含税）" value={r.summary.moldIncVat} />
            <SummaryCard label={`注塑费（${input.firstOrderQty.toLocaleString()}件 × ¥${r.summary.unitCostExVat.toFixed(2)}）含税`} value={r.summary.injectionIncVat} />
            <div className="bg-gray-900 text-white rounded-lg p-5">
              <div className="text-xs opacity-80">报价总计（含税）</div>
              <div className="text-3xl font-bold mt-2">¥ {r.summary.grandTotalIncVat.toLocaleString()}</div>
              <div className="text-xs opacity-70 mt-1">不含税 ¥{r.summary.grandTotalExVat.toLocaleString()}</div>
            </div>
          </div>
          <div className="mt-4">
            <button onClick={runCavityComparison} className="text-xs border border-gray-300 px-3 py-1.5 rounded hover:bg-gray-50">
              🎯 对比 1/2/4/8 腔数下的总成本
            </button>
            {cavityComparison && (
              <div className="mt-3 border border-gray-200 rounded p-3 bg-gray-50">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-600">
                      <th className="text-left py-1">腔数</th>
                      <th className="text-right py-1">模具合计</th>
                      <th className="text-right py-1">单件成本</th>
                      <th className="text-right py-1">总成本</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cavityComparison.map((c) => {
                      const min = Math.min(...cavityComparison.map((x) => x.grandTotal));
                      const isBest = c.grandTotal === min;
                      return (
                        <tr key={c.cavityCount} className={isBest ? 'bg-green-50 font-semibold' : ''}>
                          <td className="py-1">{c.cavityCount}腔 {isBest && '★ 最优'}</td>
                          <td className="text-right">¥{c.moldTotalExVat.toLocaleString()}</td>
                          <td className="text-right">¥{c.unitCost.toFixed(2)}</td>
                          <td className="text-right">¥{c.grandTotal.toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

const MOLD_FEE_ROWS: { key: keyof import('@mqs/calc-engine').MoldFeeItems; label: string }[] = [
  { key: 'coreSteel', label: '模芯钢料费' },
  { key: 'designFee', label: '模具设计费' },
  { key: 'moldBase', label: '模架费' },
  { key: 'standardParts', label: '标准件' },
  { key: 'cncMachining', label: 'CNC 加工' },
  { key: 'edm', label: 'EDM 电火花' },
  { key: 'wireCutting', label: '线切割' },
  { key: 'polishing', label: '省模抛光' },
  { key: 'trialMold', label: '试模费' },
  { key: 'surfaceTreatment', label: '表面处理' },
  { key: 'packagingShipping', label: '包装运输' },
];

const INJECTION_ROWS: { key: keyof import('@mqs/calc-engine').InjectionItems; label: string }[] = [
  { key: 'material', label: '材料费' },
  { key: 'machining', label: '注塑加工费' },
  { key: 'postProcess', label: '后加工费' },
  { key: 'packaging', label: '包装费' },
  { key: 'moldAmortization', label: '模具分摊' },
];

// === 子组件 ===

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="text-sm font-semibold pb-2 mb-4 border-b-2 border-gray-900">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-yellow-50 border border-yellow-300 rounded px-3 py-2 text-sm focus:border-yellow-500 focus:outline-none"
      />
    </div>
  );
}

function NumField({
  label, value, onChange, step = 1, min, max,
}: {
  label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number;
}) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full bg-yellow-50 border border-yellow-300 rounded px-3 py-2 text-sm focus:border-yellow-500 focus:outline-none"
      />
    </div>
  );
}

function SelectField({
  label, value, options, onChange,
}: {
  label: string; value: string; options: string[] | [string, string][]; onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-yellow-50 border border-yellow-300 rounded px-3 py-2 text-sm focus:border-yellow-500 focus:outline-none"
      >
        {options.map((opt) => {
          const [v, l] = Array.isArray(opt) ? opt : [opt, opt];
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
    </div>
  );
}

function OverrideCell({
  value, locked, onChange,
}: {
  value: number; locked: boolean; onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      step={0.01}
      disabled={locked}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      className={`w-24 text-right bg-white border border-gray-300 rounded px-2 py-1 text-sm focus:border-gray-900 focus:outline-none ${locked ? 'bg-gray-100 text-gray-500' : ''}`}
    />
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-bold mt-2">¥ {value.toLocaleString()}</div>
    </div>
  );
}
