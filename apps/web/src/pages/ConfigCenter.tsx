import { useEffect, useMemo, useState } from 'react';
import { configApi, materials } from '../api';
import { calculateConfigured } from '@mqs/calc-engine';
import { CALC_TYPE_META } from '@mqs/shared';
import type { MoldCalcType, QuoteItemDef } from '@mqs/shared';

const money = (n: number) => '¥ ' + Math.round(n || 0).toLocaleString('zh-CN');
/** 单价/单件成本：保留小数，不取整 */
const money2 = (n: number) =>
  '¥ ' + (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const num = (n: any) => (n === '' || n == null ? '' : String(n));

const emptyParam = (scope: 'mold' | 'injection' | 'common' = 'common') => ({
  code: '',
  name: '',
  unit: '',
  defaultValue: '',
  group: scope === 'mold' ? '模具' : scope === 'injection' ? '注塑' : '产品',
  scope,
  type: 'decimal',
  options: null,
  enabled: true,
});

/** 组内排序：产品/模具/注塑 在前，材料其次，运输这类放最后 */
const GROUP_ORDER = ['产品', '模具', '注塑', '材料', '标准件', '商务', '运输'];
const groupRank = (g?: string | null) => {
  const i = GROUP_ORDER.indexOf(String(g ?? '').trim());
  return i < 0 ? 50 : i;
};
/**
 * 这一项的数字是从哪些参数来的。
 * 配置页最难看懂的就是「公式里的名字从哪来」，这里直接列出来。
 */
const SOURCE_KEYS = ['l', 'w', 'h', 'src', 'base', 'wVar', 'priceVar', 'densityVar', 'lossVar'];
const FUNC_WORDS = new Set([
  '最大值', '最小值', '绝对值', '四舍五入', '取整', '向上取整', '向下取整', '如果',
  'max', 'min', 'abs', 'round', 'floor', 'ceil', 'if',
]);
function sourceHint(it: any): string {
  const c = it.calcConfig ?? {};
  const names = new Set<string>();
  for (const k of SOURCE_KEYS) {
    const v = c[k];
    if (typeof v === 'string' && v.trim()) names.add(v.trim());
  }
  if (it.calcType === 'formula' && it.expression) {
    const tokens =
      String(it.expression).match(/[\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_]*/g) ?? [];
    for (const t of tokens) if (!FUNC_WORDS.has(t)) names.add(t);
  }
  if (!names.size) return '';
  return `数字来自：${[...names].join(' / ')}`;
}

const emptyTerm = () => ({ text: '', enabled: true });
const emptyItem = (): any => ({
  name: '新费用',
  category: '自定义',
  scope: 'mold',
  calcType: 'fixed',
  calcConfig: { amount: 0 },
  perUnit: false,
  enabled: true,
});

export default function ConfigCenter() {
  const [types, setTypes] = useState<any[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cfg, setCfg] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [pane, setPane] = useState<'param' | 'term'>('param');
  const [folded, setFolded] = useState(false);
  const [advOpen, setAdvOpen] = useState<Record<string, boolean>>({});
  /** 产品数据的分组折叠：手风琴式，一次只展开一组（默认展开「模具参数」） */
  const [paramOpen, setParamOpen] = useState<Record<string, boolean>>({ mold: true });
  const toggleParamGroup = (k: string) =>
    setParamOpen((s) => {
      const wasOpen = !!s[k];
      const next: Record<string, boolean> = {};
      for (const key of Object.keys(s)) next[key] = false;
      if (!wasOpen) next[k] = true;
      return next;
    });
  const [picking, setPicking] = useState(false);
  /** 材料库索引（code → 材料），用于价格参数显示绑定材料的现价 */
  const [matMap, setMatMap] = useState<Record<string, any>>({});
  const [togglingPriceMode, setTogglingPriceMode] = useState(false);

  useEffect(() => {
    materials.list().then((list: any[]) => {
      const map: Record<string, any> = {};
      for (const m of list) map[m.code] = m;
      setMatMap(map);
    }).catch(() => {});
  }, []);

  // ---------- 加载 ----------
  const loadTypes = async (keepId?: string) => {
    const list = await configApi.moldTypes();
    setTypes(list);
    const next = keepId ?? activeId ?? list[0]?.id ?? null;
    setActiveId(next);
    return next;
  };

  const loadConfig = async (id: string) => {
    setLoading(true);
    const data = await configApi.get(id);
    setCfg(data);
    setDirty(false);
    setOpenItem(null);
    setLoading(false);
  };

  useEffect(() => {
    (async () => {
      const id = await loadTypes();
      if (id) await loadConfig(id);
      else setLoading(false);
    })();
  }, []);

  const switchType = async (id: string) => {
    if (dirty && !confirm('当前配置有未保存的改动，切换会丢失。确定切换吗？')) return;
    setActiveId(id);
    await loadConfig(id);
  };

  // ---------- 算价（前端直接算，实时） ----------
  const calcResult = useMemo(() => {
    if (!cfg) return null;
    const params: Record<string, number> = {};
    for (const p of cfg.parameters ?? []) {
      const n = Number(p.defaultValue);
      if (Number.isFinite(n)) params[p.name] = n;
    }
    const defs: QuoteItemDef[] = (cfg.items ?? []).map((it: any, i: number) => ({
      name: it.name,
      category: it.category,
      scope: it.scope,
      calcType: it.calcType,
      calcConfig: it.calcConfig ?? {},
      expression: it.expression,
      enabled: it.enabled !== false,
      sortOrder: it.sortOrder ?? i,
      perUnit: it.scope === 'injection' && it.perUnit === true,
    }));
    return calculateConfigured(defs, params, {
      profitRate: cfg.moldType?.profitRate ?? 0.1,
      taxRate: cfg.moldType?.taxRate ?? 0.13,
    });
  }, [cfg]);

  const lineOf = (name: string) => calcResult?.lines.find((l) => l.name === name);

  // ---------- 更新工具 ----------
  const patch = (fn: (c: any) => void) => {
    setCfg((prev: any) => {
      const next = JSON.parse(JSON.stringify(prev));
      fn(next);
      return next;
    });
    setDirty(true);
  };

  const setItemField = (idx: number, key: string, value: any) =>
    patch((c) => { c.items[idx][key] = value; });

  const setCalcCfg = (idx: number, key: string, value: any) =>
    patch((c) => {
      c.items[idx].calcConfig = { ...(c.items[idx].calcConfig ?? {}), [key]: value };
    });

  /** 参数类型：数字 / 下拉。切成下拉时给两个占位选项 */
  const setParamType = (idx: number, t: string) =>
    patch((c) => {
      const p = c.parameters[idx];
      p.type = t;
      if (t === 'select') {
        if (!Array.isArray(p.options) || !p.options.length) {
          p.options = [
            { label: '选项一', value: 1 },
            { label: '选项二', value: 2 },
          ];
        }
        if (p.defaultValue === '' || p.defaultValue == null) p.defaultValue = String(p.options[0].value);
      } else {
        p.options = null;
      }
    });

  const setParamOption = (idx: number, oi: number, key: 'label' | 'value', v: any) =>
    patch((c) => {
      const o = c.parameters[idx].options[oi];
      if (key === 'value') o.value = Number(v) || 0;
      else o.label = v;
    });

  const addParamOption = (idx: number) =>
    patch((c) => {
      const opts = c.parameters[idx].options ?? [];
      const nextVal = opts.reduce((m: number, o: any) => Math.max(m, Number(o.value) || 0), 0) + 1;
      opts.push({ label: `选项${opts.length + 1}`, value: nextVal });
      c.parameters[idx].options = opts;
    });

  const removeParamOption = (idx: number, oi: number) =>
    patch((c) => {
      c.parameters[idx].options.splice(oi, 1);
    });

  /** 单个参数的编辑卡片（名称 / 类型 / 默认值 / 下拉选项） */
  const renderParam = (p: any, i: number) => {
    const isSel = p.type === 'select';
    const opts: any[] = Array.isArray(p.options) ? p.options : [];
    const priceMode = cfg?.moldType?.priceFromLibrary === true;
    const boundMat = p.materialCode ? matMap[p.materialCode] : null;
    return (
      <div key={p.id ?? i} className="px-2 py-1.5 rounded hover:bg-gray-50 group">
        <div className="flex items-center gap-1 min-w-0">
          <input
            value={p.name}
            onChange={(e) => patch((c) => { c.parameters[i].name = e.target.value; })}
            className="flex-1 min-w-0 text-[13px] bg-transparent border border-transparent hover:border-gray-200 focus:border-gray-400 rounded px-1 py-0.5"
          />
          {p.materialCode && (
            <span
              className="shrink-0 text-[10.5px] bg-blue-50 border border-blue-200 text-blue-700 rounded px-1 py-0.5"
              title={`绑定材料「${boundMat?.name ?? p.materialCode}」，价格来自材料库`}
            >
              {p.materialCode}
            </span>
          )}
          <select
            value={p.type ?? 'decimal'}
            onChange={(e) => setParamType(i, e.target.value)}
            className="w-[52px] shrink-0 border border-gray-300 rounded px-0.5 py-0.5 text-[11px] text-gray-500"
          >
            <option value="decimal">数字</option>
            <option value="select">下拉</option>
          </select>
          <button
            onClick={() => patch((c) => { c.parameters.splice(i, 1); })}
            className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 text-sm leading-none shrink-0"
          >×</button>
        </div>

        {/* 默认值单独一行 —— 挤在同一行会把参数名压成看不见 */}
        <div className="flex items-center gap-1.5 mt-1 pl-1 min-w-0">
          <span className="text-[11px] text-gray-400 shrink-0">默认</span>
          {isSel ? (
            <select
              value={num(p.defaultValue)}
              onChange={(e) => patch((c) => { c.parameters[i].defaultValue = e.target.value; })}
              className="flex-1 min-w-0 border border-emerald-300 rounded px-1 py-0.5 text-[11.5px] bg-emerald-50 text-emerald-900"
            >
              {opts.map((o, oi) => (
                <option key={oi} value={o.value}>{o.label}</option>
              ))}
            </select>
          ) : p.materialCode && priceMode ? (
            // 材料库价格模式：绑定参数的价格由同步灌入，只读展示
            <div
              className="flex-1 min-w-0 border border-blue-200 bg-blue-50 rounded px-1.5 py-0.5 text-[12px] text-blue-900 text-right tabular-nums"
              title="材料库价格模式已开启：该价格由「同步预置配置」按材料库现价刷新"
            >
              {p.defaultValue === '' || p.defaultValue == null
                ? <span className="text-blue-400">待同步（材料库未设价）</span>
                : p.defaultValue}
            </div>
          ) : (
            <input
              type="number"
              value={num(p.defaultValue)}
              onChange={(e) => patch((c) => { c.parameters[i].defaultValue = e.target.value; })}
              className="flex-1 min-w-0 border border-gray-300 rounded px-1.5 py-0.5 text-[12px] text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          )}
          <span className="text-[11px] text-gray-400 truncate shrink-0 max-w-[64px]" title={p.unit || ''}>
            {p.unit || ''}
          </span>
        </div>

        {/* 绑定材料提示行：显示材料库现价与同步语义 */}
        {p.materialCode && (
          <p className="text-[10.5px] text-blue-600 mt-0.5 pl-1 leading-snug">
            绑定材料「{boundMat?.name ?? p.materialCode}」
            {boundMat != null && <> · 材料库现价 ¥{Number(boundMat.currentPrice).toFixed(2)}/{boundMat.unit || 'kg'}</>}
            {priceMode ? ' · 点「同步预置配置」全量刷新' : ' · 同步时只补空价'}
          </p>
        )}

        {isSel && (
          <div className="mt-1.5 border-l-2 border-emerald-200 pl-1.5 space-y-1 min-w-0">
            {opts.map((o, oi) => (
              <div key={oi} className="flex items-center gap-1 min-w-0">
                <input
                  value={o.label}
                  onChange={(e) => setParamOption(i, oi, 'label', e.target.value)}
                  className="flex-1 min-w-0 border border-gray-200 rounded px-1 py-0.5 text-[11.5px]"
                  placeholder="选项文字"
                />
                <input
                  type="number"
                  value={o.value}
                  onChange={(e) => setParamOption(i, oi, 'value', e.target.value)}
                  className="w-[72px] shrink-0 border border-gray-200 rounded px-1 py-0.5 text-[11.5px] text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  title="公式里参与计算的数值"
                />
                <button
                  onClick={() => removeParamOption(i, oi)}
                  className="text-gray-300 hover:text-red-500 text-[12px] leading-none shrink-0"
                >×</button>
              </div>
            ))}
            <button
              onClick={() => addParamOption(i)}
              className="text-[11px] text-gray-400 hover:text-gray-900"
            >+ 加选项</button>
            <p className="text-[11px] text-amber-700 leading-snug bg-amber-50 border border-amber-200 rounded px-1.5 py-1">
              这里的数字不是金额，是「系数」—— 公式会拿它去乘。
              例如运输费 = 重量 × 运费单价 × 这里的数字，所以填 300 会变成 300 倍运费；
              想固定加一笔钱，请在费用项里加「手填金额」类型的项。
            </p>
          </div>
        )}
      </div>
    );
  };

  const setCalcType = (idx: number, t: MoldCalcType) =>
    patch((c) => {
      const params: any[] = c.parameters ?? [];
      const guess = (kw: string) => params.find((p) => String(p.name).includes(kw))?.name ?? '';
      const base: Record<string, any> = {};
      if (t === 'fixed') base.amount = 0;
      if (t === 'qty') { base.src = guess('腔') || guess('数量'); base.price = 0; }
      if (t === 'size') { base.l = guess('长'); base.w = guess('宽'); base.h = guess('高'); base.density = 7.85; base.priceVar = guess('单价'); }
      if (t === 'hours') { base.hours = 0; base.rate = 0; }
      if (t === 'weight') { base.wVar = guess('重量') || guess('单件'); base.priceVar = guess('单价'); base.loss = 0.05; }
      if (t === 'percent') { base.base = '模具小计'; base.rate = 0.15; }
      c.items[idx].calcType = t;
      c.items[idx].calcConfig = base;
    });

  const setMoldTypeField = (key: string, value: any) =>
    patch((c) => { c.moldType[key] = value; });

  // ---------- 保存 ----------
  const save = async () => {
    if (!cfg || !activeId) return;
    // 参数补编码（用户没填时按名称生成）
    const payload = {
      parameters: cfg.parameters.map((p: any, i: number) => ({
        id: p.id,
        code: p.code || `p${i + 1}`,
        name: p.name,
        unit: p.unit || null,
        defaultValue: String(p.defaultValue ?? ''),
        group: p.group || '通用',
        type: p.type || 'decimal',
        materialCode: p.materialCode || null,
        options: p.type === 'select' && Array.isArray(p.options) ? p.options : null,
        enabled: p.enabled !== false,
      })),
      // 材料不在这里保存 —— 材料统一由「材料中心」（全局库）维护
      terms: cfg.terms.map((t: any) => ({ id: t.id, text: t.text, enabled: t.enabled !== false })),
      items: cfg.items.map((it: any, i: number) => ({
        id: it.id, name: it.name, category: it.category, scope: it.scope,
        calcType: it.calcType, calcConfig: it.calcConfig ?? {}, expression: it.expression ?? null,
        perUnit: it.perUnit === true,
        enabled: it.enabled !== false, sortOrder: i,
      })),
      profitRate: Number(cfg.moldType.profitRate) || 0,
      taxRate: Number(cfg.moldType.taxRate) || 0,
    };
    setSaving(true);
    try {
      await configApi.save(activeId, payload);
      await loadConfig(activeId);
      await loadTypes(activeId);
    } catch (e: any) {
      alert('保存失败：' + (e.response?.data?.error || e.message));
    } finally {
      setSaving(false);
    }
  };

  // ---------- 模具类型操作 ----------
  const initPreset = async () => {
    const r = await configApi.initPreset();
    const id = await loadTypes();
    if (id) await loadConfig(id);
    alert(
      `已初始化 ${r.created} 套、增量补齐 ${r.filled} 套（补参数 ${r.addedParams} 个、费用项 ${r.addedItems} 个，从材料库补价 ${r.filledPrices} 个；已有配置不覆盖）`,
    );
  };

  /** 分类同步：只同步当前激活的这一套（补缺失参数/费用项 + 从材料库补空价），不覆盖已有 */
  const syncCurrentPreset = async () => {
    const t = types.find((x) => x.id === activeId);
    if (!t) return;
    const modeB = cfg?.moldType?.priceFromLibrary === true;
    if (
      !confirm(
        modeB
          ? `把「${t.name}」与官方预置配置对齐？\n\n· 缺的参数 / 费用项 / 条款会补上\n· 材料库价格模式已开启：绑定材料的价格将按材料库现价全量刷新\n· 其余已有配置不动\n\n确定继续吗？`
          : `把「${t.name}」与官方预置配置对齐？\n\n· 缺的参数 / 费用项 / 条款会补上\n· 空着的价格会从材料库自动补价\n· 你已改过的配置和价格一律不动\n\n确定继续吗？`,
      )
    )
      return;
    try {
      const r = await configApi.initPreset({ code: t.code });
      await loadTypes(activeId!);
      await loadConfig(activeId!);
      const parts: string[] = [];
      if (r.created) parts.push(`新建了这套配置`);
      if (r.addedParams) parts.push(`补参数 ${r.addedParams} 个`);
      if (r.addedItems) parts.push(`补费用项 ${r.addedItems} 个`);
      if (r.filledPrices) parts.push(`从材料库补价 ${r.filledPrices} 个`);
      alert(parts.length ? `同步完成：${parts.join('，')}。已有配置未覆盖。` : '配置已是最全状态，无需补充。');
    } catch (e: any) {
      alert('同步失败：' + (e.response?.data?.error || e.message));
    }
  };

  /** 材料库价格模式：开启后绑定材料的价格默认值由材料库全量刷新（库是唯一真源） */
  const togglePriceMode = async () => {
    if (!cfg || togglingPriceMode) return;
    const cur = cfg.moldType?.priceFromLibrary === true;
    if (!cur) {
      const n = (cfg.parameters ?? []).filter((p: any) => p.materialCode).length;
      if (
        !confirm(
          `开启「材料库价格模式」？\n\n· 绑定了材料的 ${n} 个价格参数，默认值将立即按材料库现价刷新（覆盖）\n· 之后点「同步预置配置」也会全量刷新这些价格\n· 库改价 → 同步 → 这里生效，逻辑只有一条\n\n确定开启吗？`,
        )
      )
        return;
    } else if (
      !confirm('关闭「材料库价格模式」？\n\n关闭后价格参数可手动编辑，同步只补空价、不再覆盖。')
    )
      return;
    setTogglingPriceMode(true);
    try {
      await configApi.updateMoldType(activeId!, { priceFromLibrary: !cur });
      await loadConfig(activeId!);
    } catch (e: any) {
      alert('操作失败：' + (e.response?.data?.error || e.message));
    } finally {
      setTogglingPriceMode(false);
    }
  };

  const addType = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const name = prompt('新模具类型名称：', '橡胶模具');
      if (!name) return;
      const copyFrom = confirm('是否复制当前类型的配置作为起点？\n确定＝复制，取消＝从空白开始');
      const created = await configApi.createMoldType(copyFrom ? { name, copyFromId: activeId! } : { name });
      await loadTypes(created.id);
      await loadConfig(created.id);
    } finally {
      setPicking(false);
    }
  };

  const renameType = async () => {
    if (!cfg) return;
    const name = prompt('重命名为：', cfg.moldType.name);
    if (!name) return;
    await configApi.updateMoldType(activeId!, { name });
    await loadTypes(activeId!);
    await loadConfig(activeId!);
  };

  const delType = async () => {
    if (!cfg) return;
    if (!confirm(`删除「${cfg.moldType.name}」及其全部参数与费用项？`)) return;
    try {
      await configApi.removeMoldType(activeId!);
      const id = await loadTypes();
      if (id) await loadConfig(id);
    } catch (e: any) {
      alert(e.response?.data?.error || e.message);
    }
  };

  // ---------- 渲染 ----------
  if (loading && !cfg) return <div className="max-w-7xl mx-auto p-6 text-gray-400">加载中…</div>;

  if (types.length === 0) {
    return (
      <div className="max-w-3xl mx-auto p-10 text-center">
        <h1 className="text-lg font-semibold mb-2">还没有模具类型</h1>
        <p className="text-sm text-gray-500 mb-6">
          一键初始化注塑、压铸、双色、橡胶四套预置配置，之后可随意增删改
        </p>
        <button onClick={initPreset} className="bg-gray-900 text-white px-5 py-2.5 rounded text-sm">
          初始化预置模具类型
        </button>
      </div>
    );
  }

  const params: any[] = cfg?.parameters ?? [];
  const terms: any[] = cfg?.terms ?? [];
  const items: any[] = cfg?.items ?? [];
  const gridCols = folded ? '330px minmax(0,1fr) 48px' : '330px minmax(0,1fr) 330px';

  return (
    <div className="max-w-[1600px] mx-auto p-5">
      {/* 顶部 */}
      <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 mb-3 flex items-center gap-3 flex-wrap">
        <div className="w-7 h-7 rounded bg-gray-900 text-white flex items-center justify-center text-xs font-bold shrink-0">M</div>
        <span className="font-semibold text-sm shrink-0">报价配置中心</span>

        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 ml-2 flex-wrap">
          {types.map((t) => (
            <button
              key={t.id}
              onClick={() => switchType(t.id)}
              className={`px-3 py-1 rounded text-[13px] whitespace-nowrap ${
                t.id === activeId ? 'bg-white font-medium shadow-sm' : 'text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t.name}
            </button>
          ))}
          <button onClick={addType} className="px-2.5 py-1 rounded text-[12.5px] text-gray-500 border border-dashed border-gray-300 hover:border-gray-900 hover:text-gray-900">
            + 新类型
          </button>
        </div>

        <div className="flex-1" />

        {activeId && (
          <>
            <button
              onClick={togglePriceMode}
              disabled={togglingPriceMode}
              title="开启后：绑定材料的价格默认值由材料库同步刷新，库是唯一价格真源"
              className={`text-xs px-2 border rounded py-1 transition ${
                cfg?.moldType?.priceFromLibrary === true
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                  : 'text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-900'
              }`}
            >
              材料库价格模式：{cfg?.moldType?.priceFromLibrary === true ? '开' : '关'}
            </button>
            <button
              onClick={syncCurrentPreset}
              className="text-xs text-gray-500 hover:text-gray-900 px-2 border border-gray-200 rounded py-1 hover:border-gray-400"
              title="把当前类型与官方预置对齐：只补缺失项与空价格，不覆盖已有配置"
            >
              同步预置配置
            </button>
            <button onClick={renameType} className="text-xs text-gray-500 hover:text-gray-900 px-2">重命名</button>
            <button onClick={delType} className="text-xs text-gray-500 hover:text-red-600 px-2">删除类型</button>
          </>
        )}
        <button onClick={() => setFolded(!folded)} className="border border-gray-300 px-3 py-1.5 rounded text-[12.5px] hover:bg-gray-50">
          {folded ? '展开算价栏' : '折叠算价栏'}
        </button>
        <button
          onClick={save}
          disabled={saving || !dirty}
          className={`px-4 py-1.5 rounded text-[13px] font-medium ${
            dirty ? 'bg-gray-900 text-white hover:bg-gray-800' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}
        >
          {saving ? '保存中…' : dirty ? '保存' : '已保存'}
        </button>
      </div>

      {/* 引导条 */}
      <div className={`text-[12.5px] px-3.5 py-2 rounded-lg mb-3 border ${
        dirty ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
      }`}>
        {dirty
          ? '有改动还没保存 · 点右上角「保存」后才会生效'
          : '左边是报价时要填的数据；中间是要收哪些费用，选计算方式、填数字就行，不用写公式；右边立刻出价'}
      </div>

      {/* 三栏 */}
      <div className="grid gap-3.5 items-start" style={{ gridTemplateColumns: gridCols }}>
        {/* ① 可插拔内容 */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-3.5 py-3 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-gray-900 text-white text-[11px] flex items-center justify-center">1</span>
              <span className="font-semibold text-sm">报价时填写</span>
            </div>
            <span className="text-[12px] text-gray-400">{params.length} 项</span>
          </div>
          <div className="p-3.5">
            <div className="flex gap-0.5 bg-gray-100 p-0.5 rounded-lg mb-2.5">
              {([['param', '产品数据'], ['term', '条款']] as const).map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setPane(k)}
                  className={`flex-1 py-1 rounded text-[12.5px] ${pane === k ? 'bg-white font-medium shadow-sm' : 'text-gray-600'}`}
                >
                  {l}
                </button>
              ))}
            </div>

            {/* 参数：按 模具 / 注塑 / 公共 分组，组内重要靠前 */}
            {pane === 'param' && (
              <div className="space-y-3">
                {(
                  [
                    { k: 'mold', t: '模具参数', d: '每套模具单独填' },
                    { k: 'injection', t: '注塑参数', d: '每个注塑件单独填' },
                    { k: 'common', t: '公共参数', d: '整单共享一份' },
                  ] as const
                ).map((g) => {
                  const list = params
                    .map((p, i) => ({ p, i }))
                    .filter((x) => (x.p.scope ?? 'common') === g.k)
                    .sort(
                      (a, b) =>
                        groupRank(a.p.group) - groupRank(b.p.group) ||
                        (a.p.sortOrder ?? 0) - (b.p.sortOrder ?? 0),
                    );
                  return (
                    <div key={g.k}>
                      <button
                        onClick={() => toggleParamGroup(g.k)}
                        className="w-full flex items-center gap-2 pt-1 pb-1.5 border-b border-gray-100 text-left hover:text-gray-900"
                      >
                        <span className="text-gray-400 text-[10px] w-3">{paramOpen[g.k] ? '▼' : '▶'}</span>
                        <span className="text-[12.5px] font-medium text-gray-900">{g.t}</span>
                        <span className="text-[11px] text-gray-400">{g.d}</span>
                        <div className="flex-1" />
                        <span className="text-[11px] text-gray-400 tabular-nums">{list.length}</span>
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            patch((c) => { c.parameters.push(emptyParam(g.k)); });
                          }}
                          className="border border-gray-300 px-2 py-0.5 rounded text-[11.5px] hover:bg-gray-50"
                        >+ 加一项</span>
                      </button>
                      {paramOpen[g.k] && (
                        <>
                          {list.length === 0 && (
                            <p className="text-[12px] text-gray-400 py-1.5">这一类还没有参数</p>
                          )}
                          <div className="space-y-0.5">
                            {list.map(({ p, i }) => renderParam(p, i))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
                <p className="text-[11.5px] text-gray-400 pt-1">这些是报价时填的数字，改这里右边立刻重算</p>
              </div>
            )}


            {/* 条款 */}
            {pane === 'term' && (
              <div className="space-y-1.5">
                {terms.map((t, i) => (
                  <div key={t.id ?? i} className="flex gap-1.5 items-start">
                    <textarea
                      value={t.text}
                      onChange={(e) => patch((c) => { c.terms[i].text = e.target.value; })}
                      rows={2}
                      className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-[12.5px] resize-y"
                    />
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => patch((c) => { c.terms[i].enabled = !c.terms[i].enabled; })}
                        className={`px-2 py-0.5 rounded text-[11.5px] border ${
                          t.enabled !== false ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-400'
                        }`}
                      >{t.enabled !== false ? '启用' : '停用'}</button>
                      <button
                        onClick={() => patch((c) => { c.terms.splice(i, 1); })}
                        className="text-gray-300 hover:text-red-500 text-sm leading-none"
                      >×</button>
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => patch((c) => { c.terms.push(emptyTerm()); })}
                  className="w-full py-1.5 border border-dashed border-gray-300 rounded text-[12.5px] text-gray-500 hover:border-gray-900 hover:text-gray-900"
                >+ 加一条</button>
                <p className="text-[11.5px] text-gray-400">会印在给客户的报价单上</p>
              </div>
            )}
          </div>
        </div>

        {/* ② 费用项 */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-3.5 py-3 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-gray-900 text-white text-[11px] flex items-center justify-center">2</span>
              <span className="font-semibold text-sm">要收哪些费用</span>
              <span className="text-[12px] text-gray-400">{items.length} 项</span>
            </div>
          </div>
          <div className="p-3.5">
            {items.length === 0 && <p className="text-center text-gray-400 text-[13px] py-8">还没有费用项，点每个分组右上角的「加一项」</p>}
            {(
              [
                { k: 'mold' as const, t: '模具费（一次性）', d: '开模收一次，不随订单数量变' },
                { k: 'injection' as const, t: '注塑费（按件）', d: '先算单件成本，再 × 数量' },
              ] as const
            ).map((g) => {
              const group = items
                .map((it, i) => ({ it, i }))
                .filter((x) => (x.it.scope ?? 'mold') === g.k);
              return (
                <div key={g.k} className="mb-4 last:mb-0">
                  <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-gray-100">
                    <span className="text-[13px] font-medium text-gray-900">{g.t}</span>
                    <span className="text-[11.5px] text-gray-400">{g.d}</span>
                    <div className="flex-1" />
                    <span className="text-[11.5px] text-gray-400 tabular-nums">{group.length} 项</span>
                    <button
                      onClick={() => patch((c) => { c.items.push({ ...emptyItem(), scope: g.k }); })}
                      className="border border-gray-300 px-2 py-0.5 rounded text-[11.5px] hover:bg-gray-50"
                    >+ 加一项</button>
                  </div>
                  {group.length === 0 && (
                    <p className="text-[12px] text-gray-400 py-1.5">这一类还没有费用项</p>
                  )}
                  <div className="space-y-2">
                    {group.map(({ it, i }) => {
                const line = lineOf(it.name);
                const open = openItem === (it.id ?? String(i));
                const key = it.id ?? String(i);
                const meta = CALC_TYPE_META.find((m) => m.v === it.calcType);
                const val = it.enabled === false ? '—' : line?.error ? '出错了' : line?.manual ? '报价时填' : money(line?.value ?? 0);
                return (
                  <div key={key}>
                    <div
                      onClick={() => setOpenItem(open ? null : key)}
                      className={`flex items-center gap-2 px-2.5 py-2.5 rounded-lg border cursor-pointer ${
                        open ? 'border-gray-900' : it.enabled === false ? 'border-gray-200 bg-gray-50 opacity-60' : 'border-gray-200 hover:border-gray-400'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={it.enabled !== false}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setItemField(i, 'enabled', e.target.checked)}
                        className="w-4 h-4 shrink-0"
                      />
                      <span className="flex-1 text-[13.5px] font-medium truncate">{it.name}</span>
                      <span className="text-[11.5px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded whitespace-nowrap">{meta?.n ?? it.calcType}</span>
                      <span className="text-[13.5px] font-semibold tabular-nums whitespace-nowrap">{val}</span>
                    </div>

                    {open && (
                      <div className="border border-gray-900 rounded-lg p-3.5 mt-1.5">
                        <div className="flex items-center gap-2 flex-wrap mb-2.5">
                          <span className="text-[12.5px] text-gray-500">计算方式</span>
                          <select
                            value={it.calcType}
                            onChange={(e) => setCalcType(i, e.target.value as MoldCalcType)}
                            className="border border-gray-300 rounded px-2 py-1.5 text-[13px]"
                          >
                            {CALC_TYPE_META.map((m) => <option key={m.v} value={m.v}>{m.n}</option>)}
                          </select>
                          <span className="text-[11.5px] text-gray-400">{meta?.d}</span>
                        </div>

                        <CalcFields
                          item={it}
                          params={params}
                          onChange={(k, v) => {
                            if (k === '__expr__') setItemField(i, 'expression', v);
                            else setCalcCfg(i, k, v);
                          }}
                        />

                        <div className="flex items-center gap-2 flex-wrap mt-2.5">
                          <span className="text-[12.5px] text-gray-500">名称</span>
                          <input
                            value={it.name}
                            onChange={(e) => setItemField(i, 'name', e.target.value)}
                            className="border border-gray-300 rounded px-2 py-1.5 text-[13px] w-[160px]"
                          />
                          <span className="text-[12.5px] text-gray-500">计入</span>
                          <select
                            value={it.scope}
                            onChange={(e) => setItemField(i, 'scope', e.target.value)}
                            className="border border-gray-300 rounded px-2 py-1.5 text-[13px]"
                          >
                            <option value="mold">模具</option>
                            <option value="injection">注塑</option>
                          </select>
                          {it.scope === 'injection' && (
                            <label
                              className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-300 rounded px-2.5 py-1.5 cursor-pointer"
                              title="勾上后，这里填的是「单件成本」，系统自动乘以注塑数量得总额"
                            >
                              <input
                                type="checkbox"
                                checked={it.perUnit === true}
                                onChange={(e) => setItemField(i, 'perUnit', e.target.checked)}
                                className="w-3.5 h-3.5 accent-emerald-600"
                              />
                              <span className="text-[12.5px] font-medium text-emerald-800">按件计价</span>
                              <span className="text-[11.5px] text-emerald-600">填单件成本，自动 × 数量</span>
                            </label>
                          )}
                        </div>

                        {line?.error ? (
                          <div className="mt-2.5 text-[12.5px] bg-red-50 border border-red-200 text-red-700 rounded px-2.5 py-2">
                            {line.error}
                          </div>
                        ) : line?.manual ? (
                          <div className="mt-2.5 text-[12.5px] bg-gray-50 border border-gray-200 text-gray-600 rounded px-2.5 py-2">
                            报价时手动填写金额
                          </div>
                        ) : (
                          <div className="mt-2.5 text-[12.5px] bg-emerald-50 border border-emerald-200 text-emerald-800 rounded px-2.5 py-2 font-mono break-all">
                            {line?.readable}　=　<b>{money(line?.value ?? 0)}</b>
                          </div>
                        )}
                        {sourceHint(it) && (
                          <div className="mt-1.5 text-[11.5px] text-gray-500">{sourceHint(it)}</div>
                        )}
                        {line?.warning && (
                          <div className="mt-1.5 text-[12.5px] bg-amber-50 border border-amber-200 text-amber-800 rounded px-2.5 py-2">
                            ⚠ {line.warning}
                          </div>
                        )}

                        <div className="flex items-center gap-3 mt-2.5">
                          <button
                            onClick={() => setAdvOpen({ ...advOpen, [key]: !advOpen[key] })}
                            className="text-[12px] text-gray-500 underline hover:text-gray-900"
                          >{advOpen[key] ? '收起高级选项' : '高级选项'}</button>
                          <div className="flex-1" />
                          <button
                            onClick={() => patch((c) => { c.items.splice(i, 1); })}
                            className="border border-gray-300 text-red-600 px-3 py-1 rounded text-[12.5px] hover:bg-red-50"
                          >删除这一项</button>
                        </div>

                        {advOpen[key] && (
                          <div className="mt-2 flex items-center gap-2 flex-wrap text-[12.5px] bg-blue-50 border border-blue-200 rounded px-2.5 py-2">
                            <span className="text-gray-600">分类标签</span>
                            <input
                              value={it.category}
                              onChange={(e) => setItemField(i, 'category', e.target.value)}
                              className="border border-gray-300 rounded px-2 py-1 w-[110px]"
                            />
                            <span className="text-gray-600 ml-2">说明（给客户看）</span>
                            <input
                              value={it.note ?? ''}
                              onChange={(e) => setItemField(i, 'note', e.target.value)}
                              className="border border-gray-300 rounded px-2 py-1 flex-1 min-w-[140px]"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ③ 算价 */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {folded ? (
            <div onClick={() => setFolded(false)} className="py-4 flex flex-col items-center gap-3 cursor-pointer" title="点击展开">
              <span className="text-[13px] text-gray-600" style={{ writingMode: 'vertical-rl', letterSpacing: 2 }}>算价结果</span>
              <span className="text-[12px] text-gray-400" style={{ writingMode: 'vertical-rl' }}>{money(calcResult?.total ?? 0)}</span>
            </div>
          ) : (
            <>
              <div className="px-3.5 py-3 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-gray-900 text-white text-[11px] flex items-center justify-center">3</span>
                  <span className="font-semibold text-sm">实时算价</span>
                  <span className="text-[11.5px] text-gray-500 border border-gray-200 rounded px-1.5 py-0.5">
                    用默认值预览
                  </span>
                </div>
                <button onClick={() => setFolded(true)} className="border border-gray-300 rounded px-2 py-0.5 text-[11.5px] text-gray-500">折叠</button>
              </div>
              <div className="px-3.5 pt-2 pb-1 text-[11.5px] text-gray-400">
                下面用的是「产品数据」里的默认值，只用来检查价格逻辑；实际报价以报价页填的数为准。
              </div>
              <div className="p-3.5 max-h-[520px] overflow-y-auto">
                {(calcResult?.lines ?? []).map((l, i) => (
                  <div key={i} className="py-2 border-b border-gray-50 last:border-0">
                    <div className="flex justify-between items-baseline gap-2">
                      <span className={`text-[13.5px] ${l.skipped ? 'text-gray-400' : ''}`}>
                        {l.name}{l.skipped ? '（已停用）' : ''}
                      </span>
                      <span className="text-[13.5px] font-semibold tabular-nums">
                        {l.error ? '—' : l.manual ? '报价时填' : money(l.value)}
                      </span>
                    </div>
                    {l.error ? (
                      <div className="text-[12.5px] text-red-600 mt-0.5">{l.error}</div>
                    ) : (
                      <>
                        <div className="text-[12px] text-blue-700 mt-0.5 font-mono">{l.readable}</div>
                        {l.scope === 'injection' && l.unitPrice != null && (
                          <div className="text-[12px] text-emerald-700 mt-0.5 font-mono">
                            单件 {money2(l.unitPrice)}　×　
                            {(l.qty ?? 0).toLocaleString('zh-CN')} 件
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
                {(!calcResult || calcResult.lines.length === 0) && (
                  <p className="text-center text-gray-400 text-[13px] py-6">加费用项后这里显示每一项怎么算出来的</p>
                )}
              </div>
              <div className="bg-gray-50 border-t border-gray-200 px-3.5 py-3">
                <div className="flex justify-between text-[13px] text-gray-600 py-0.5"><span>模具费用</span><span>{money(calcResult?.mold ?? 0)}</span></div>
                <div className="flex justify-between text-[13px] text-gray-600 py-0.5 gap-2">
                  <span className="min-w-0">
                    注塑费用
                    {calcResult?.unitCost != null && calcResult?.injectionQty != null && (
                      <span className="text-[11.5px] text-emerald-700 ml-1 whitespace-nowrap">
                        单件 {money2(calcResult.unitCost)} × {calcResult.injectionQty.toLocaleString('zh-CN')} 件
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums">{money(calcResult?.injection ?? 0)}</span>
                </div>

                <div className="flex justify-between items-center text-[13px] text-gray-600 py-0.5 gap-2">
                  <span>利润率</span>
                  <span className="flex items-center gap-1.5">
                    <input
                      type="number"
                      step="0.01"
                      value={num(cfg?.moldType?.profitRate)}
                      onChange={(e) => setMoldTypeField('profitRate', Number(e.target.value))}
                      className="w-[62px] border border-gray-300 rounded px-1.5 py-0.5 text-[12.5px] text-right"
                    />
                    <span className="w-[70px] text-right">{money(calcResult?.profit ?? 0)}</span>
                  </span>
                </div>
                <div className="flex justify-between items-center text-[13px] text-gray-600 py-0.5 gap-2">
                  <span>税率</span>
                  <span className="flex items-center gap-1.5">
                    <input
                      type="number"
                      step="0.01"
                      value={num(cfg?.moldType?.taxRate)}
                      onChange={(e) => setMoldTypeField('taxRate', Number(e.target.value))}
                      className="w-[62px] border border-gray-300 rounded px-1.5 py-0.5 text-[12.5px] text-right"
                    />
                    <span className="w-[70px] text-right">{money(calcResult?.tax ?? 0)}</span>
                  </span>
                </div>
                <div className="flex justify-between items-baseline pt-2 mt-1.5 border-t border-gray-200">
                  <span className="text-[13.5px] font-semibold">含税总价</span>
                  <b className="text-[21px]">{money(calcResult?.total ?? 0)}</b>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** 按计算方式渲染对应的填空 */
function CalcFields({
  item,
  params,
  onChange,
}: {
  item: any;
  params: any[];
  onChange: (key: string, value: any) => void;
}) {
  const c = item.calcConfig ?? {};
  const inp = 'border border-gray-300 rounded px-2 py-1.5 text-[13px]';
  const Var = ({ k, label }: { k: string; label: string }) => (
    <>
      <span className="text-[12.5px] text-gray-500">{label}</span>
      <select value={c[k] ?? ''} onChange={(e) => onChange(k, e.target.value)} className={inp}>
        <option value="">（选择）</option>
        {params.map((p) => <option key={p.id ?? p.name} value={p.name}>{p.name}</option>)}
      </select>
    </>
  );
  const NumIn = ({ k, label, step, suffix }: any) => (
    <>
      <span className="text-[12.5px] text-gray-500">{label}</span>
      <input
        type="number"
        step={step ?? 'any'}
        value={num(c[k])}
        onChange={(e) => onChange(k, Number(e.target.value))}
        className={`${inp} w-[86px] text-right`}
      />
      {suffix && <span className="text-[11.5px] text-gray-400">{suffix}</span>}
    </>
  );

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {item.calcType === 'fixed' && <NumIn k="amount" label="金额" suffix="元" />}
      {item.calcType === 'qty' && (
        <>
          <Var k="src" label="数量按" />
          <NumIn k="price" label="单价" suffix="元" />
        </>
      )}
      {item.calcType === 'size' && (
        <>
          <Var k="l" label="长" />
          <Var k="w" label="宽" />
          <Var k="h" label="高（可留空）" />
          <NumIn k="density" label="材料密度" suffix="g/cm³" />
          <Var k="priceVar" label="单价按" />
        </>
      )}
      {item.calcType === 'hours' && (
        <>
          <NumIn k="hours" label="工时" suffix="小时" />
          <NumIn k="rate" label="时薪" suffix="元/小时" />
        </>
      )}
      {item.calcType === 'weight' && (
        <>
          <Var k="wVar" label="重量按" />
          <Var k="priceVar" label="单价按" />
          <NumIn k="loss" label="损耗率" step="0.01" />
        </>
      )}
      {item.calcType === 'percent' && (
        <>
          <span className="text-[12.5px] text-gray-500">基数</span>
          <select value={c.base ?? '模具小计'} onChange={(e) => onChange('base', e.target.value)} className={inp}>
            <option value="模具小计">模具小计</option>
            <option value="材料费合计">材料费合计</option>
          </select>
          <NumIn k="rate" label="比例" step="0.01" />
        </>
      )}
      {item.calcType === 'manual' && (
        <div className="text-[12.5px] bg-blue-50 border border-blue-200 text-blue-800 rounded px-2.5 py-1.5 w-full">
          这一项不预设算法，报价时由你手动填金额。
        </div>
      )}
      {item.calcType === 'formula' && (
        <div className="w-full">
          <input
            value={item.expression ?? ''}
            onChange={(e) => onChange('__expr__', e.target.value)}
            placeholder="例：腔数 乘以 1500"
            className={`${inp} w-full font-mono`}
          />
          <p className="text-[11.5px] text-gray-400 mt-1">
            可以用中文写：加上、减去、乘以、除以、大于等于、且、或、如果…那么…否则
          </p>
        </div>
      )}
    </div>
  );
}
