import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { configApi, materials as materialsApi, quotes } from '../api';
import { calculateQuoteProject } from '@mqs/calc-engine';
import type { QuoteItemDef } from '@mqs/shared';
import { QTY_VAR_CANDIDATES, resolveMaterialPrice } from '@mqs/shared';

const money = (n: number) => '¥ ' + Math.round(n || 0).toLocaleString('zh-CN');
const money2 = (n: number) =>
  '¥ ' + (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const uid = () => Math.random().toString(36).slice(2, 9);

/**
 * 材料单位 → kg 换算系数。
 * 返回 null 表示这个单位不适合「按重量计价」（个 / 件 / 米…），报价时不该选它。
 */
const kgFactorOf = (unit?: string | null): number | null => {
  const u = String(unit || 'kg').trim().toLowerCase();
  if (u === 'kg' || u === '千克' || u === '公斤') return 1;
  if (u === 'g' || u === '克') return 0.001;
  if (u === 't' || u === '吨') return 1000;
  return null;
};

interface MoldState {
  uid: string;
  code: string;
  name: string;
  /** 本套模具所用钢材编码（来自材料库；空=用公共参数里的钢材单价） */
  materialCode: string;
  params: Record<string, any>;
  manuals: Record<string, number>;
}
interface PartState {
  uid: string;
  code: string;
  name: string;
  materialCode: string;
  qty: any;
  params: Record<string, any>;
  manuals: Record<string, number>;
}

export default function ConfiguredQuote() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();

  const [types, setTypes] = useState<any[]>([]);
  const [activeId, setActiveId] = useState('');
  const [cfg, setCfg] = useState<any | null>(null);
  const [commonParams, setCommonParams] = useState<Record<string, any>>({});
  const [molds, setMolds] = useState<MoldState[]>([]);
  const [parts, setParts] = useState<PartState[]>([]);
  const [customer, setCustomer] = useState({ name: '', phone: '', productName: '' });
  const [matList, setMatList] = useState<any[]>([]);
  /** 右栏「费用明细」展开状态（m0/m1=模具，p0/p1=注塑件） */
  const [detailOpen, setDetailOpen] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [source, setSource] = useState<any | null>(null);
  const copyFrom = sp.get('copyFrom');

  // 加载模具类型；如有 copyFrom，拉取源报价并选中其模具类型
  useEffect(() => {
    configApi.moldTypes().then((list: any[]) => {
      setTypes(list);
      if (!list.length) {
        setLoading(false);
        return;
      }
      if (copyFrom) {
        setLoading(true);
        quotes
          .get(copyFrom)
          .then((src: any) => {
            setSource(src);
            const want = src?.moldTypeId;
            const pick = list.find((t) => t.id === want) ?? list[0];
            setActiveId(pick.id);
          })
          .catch(() => {
            const want = sp.get('type');
            setActiveId(list.find((t) => t.id === want)?.id ?? list[0].id);
          })
          .finally(() => setLoading(false));
      } else {
        const want = sp.get('type');
        const pick = list.find((t) => t.id === want) ?? list[0];
        setActiveId(pick.id);
      }
    });
  }, []);

  // 加载配置 + 材料库；若 copyFrom 且为 project 报价，则回填数据
  useEffect(() => {
    if (!activeId) return;
    setLoading(true);
    Promise.all([configApi.get(activeId), materialsApi.list()])
      .then(([data, mats]) => {
        setCfg(data);
        setMatList(mats ?? []);
        const srcParamsJson = source?.versions?.[0]?.paramsJson;
        if (copyFrom && source && srcParamsJson?.kind === 'project' && source.moldTypeId === activeId) {
          prefillFromSource(data, srcParamsJson);
        } else {
          const v: Record<string, any> = {};
          for (const p of data.parameters ?? []) {
            if (p.enabled === false) continue;
            if ((p.scope as string) === 'common') v[p.name] = p.defaultValue ?? '';
          }
          setCommonParams(v);
          // 注意：这里不能直接用 qtyVarName / qtyDefault 这两个 useMemo ——
          // 它们是从 cfg 派生的，而 setCfg(data) 要等下一次渲染才生效，
          // 此刻拿到的还是旧值（首次加载时是空），会把注塑件数量填成 0。
          // 所以和 prefillFromSource 一样，从 data 里现算。
          const qv = resolveQtyVar(data);
          const qd = qtyDefaultOf(data, qv);
          setMolds([seedMold(data, 1)]);
          setParts([seedPart(data, 1, qd, qv)]);
        }
      })
      .finally(() => setLoading(false));
  }, [activeId]);

  /** 从配置里找出「数量」参数的名称（注塑数量 / 压铸数量 / 成型数量 …） */
  const resolveQtyVar = (data: any): string => {
    const list: any[] = (data?.parameters ?? []).filter((p: any) => p.enabled !== false);
    const hit = list.find((p) => QTY_VAR_CANDIDATES.includes(p.name));
    return hit?.name ?? '注塑数量';
  };

  /** 该数量参数的默认值 */
  const qtyDefaultOf = (data: any, qv: string): any => {
    const p = (data?.parameters ?? []).find((x: any) => x.name === qv);
    return p?.defaultValue ?? 0;
  };

  const params: any[] = (cfg?.parameters ?? []).filter((p: any) => p.enabled !== false);
  const commonDefs = useMemo(() => params.filter((p) => (p.scope as string) === 'common'), [cfg]);
  const moldDefs = useMemo(() => params.filter((p) => (p.scope as string) === 'mold'), [cfg]);
  const injectionDefs = useMemo(() => params.filter((p) => (p.scope as string) === 'injection'), [cfg]);

  // 数量参数名（注塑数量 / 压铸数量 / 成型数量…）
  const qtyVarName = useMemo(() => {
    const hit = params.find((p) => QTY_VAR_CANDIDATES.includes(p.name));
    return hit?.name ?? '注塑数量';
  }, [cfg]);
  const qtyDefault = useMemo(() => {
    const p = params.find((x) => x.name === qtyVarName);
    return p?.defaultValue ?? 0;
  }, [cfg, qtyVarName]);

  // 注塑材料费项引用的「原料单价 / 合金单价」+「损耗率」+「单件重量」参数名（按重量项推导）
  const injectionVars = useMemo(() => {
    const w = (cfg?.items ?? []).find(
      (it: any) => it.scope === 'injection' && it.calcType === 'weight',
    );
    const c = (w?.calcConfig ?? {}) as any;
    return {
      priceVar: c.priceVar as string | undefined,
      lossVar: c.lossVar as string | undefined,
      wVar: c.wVar as string | undefined,
    };
  }, [cfg]);
  const injectionPriceVar = injectionVars.priceVar;

  // 模具钢材费项引用的「单价 / 密度 / 损耗率」参数名（按尺寸项推导）
  const moldSteelVars = useMemo(() => {
    const s = (cfg?.items ?? []).find((it: any) => it.scope === 'mold' && it.calcType === 'size');
    const c = (s?.calcConfig ?? {}) as any;
    return {
      cfg: c,
      priceVar: c.priceVar as string | undefined,
      densityVar: c.densityVar as string | undefined,
      lossVar: c.lossVar as string | undefined,
    };
  }, [cfg]);

  /**
   * 报价页可选材料：必须「启用」且单位能用于按重量计价。
   * 停用的材料不再出现在下拉里；单价本身按单位折算成「元/kg」。
   */
  const usableMaterials = useMemo(
    () => matList.filter((m) => m.enabled !== false && kgFactorOf(m.unit) != null),
    [matList],
  );

  /**
   * 材料单价（元/kg）。
   * consumption = 本次该材料的用量（kg）；给了就按阶梯价取，否则用基础单价。
   * 逻辑与服务端完全一致（同一个 resolveMaterialPrice）。
   */
  const pricePerKgOf = (m: any, consumption?: number | null): number => {
    const base = resolveMaterialPrice(m, consumption ?? null);
    const k = kgFactorOf(m.unit);
    return k ? base / k : base;
  };

  /** 由「按尺寸算」配置估算钢材用量(kg) —— 与服务端 sizeItemWeightKg 一致 */
  const sizeWeightKg = (c: any, params: Record<string, any>): number | null => {
    const keys = [c?.l, c?.w, c?.h].filter((x: any) => x && String(x).trim());
    if (!keys.length) return null;
    let vol = 1;
    for (const k of keys) {
      const v = Number(params[k]);
      if (!Number.isFinite(v)) return null;
      vol *= v;
    }
    const dVar = c?.densityVar as string | undefined;
    const density = Number(dVar && params[dVar] != null ? params[dVar] : c?.density);
    if (!Number.isFinite(density) || density <= 0) return null;
    return (vol / 1000) * (density / 1000);
  };

  // 材料库里的钢材（一级分类=模具钢材），按二级分类分组给下拉用
  const steelGroups = useMemo(() => {
    const g = new Map<string, any[]>();
    for (const m of usableMaterials) {
      if (m.category !== '模具钢材') continue;
      const k = (m.subCategory as string) || '其他钢材';
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(m);
    }
    return [...g.entries()] as [string, any[]][];
  }, [usableMaterials]);

  const manualMoldItems = useMemo(
    () => (cfg?.items ?? []).filter((it: any) => it.enabled !== false && it.calcType === 'manual' && it.scope === 'mold'),
    [cfg],
  );
  const manualInjItems = useMemo(
    () => (cfg?.items ?? []).filter((it: any) => it.enabled !== false && it.calcType === 'manual' && it.scope === 'injection'),
    [cfg],
  );

  const matByCode = useMemo(() => new Map(matList.map((m) => [m.code, m])), [matList]);

  function seedMold(data: any, i: number): MoldState {
    const p: Record<string, any> = {};
    for (const d of data.parameters ?? []) {
      if ((d.scope as string) === 'mold' && d.enabled !== false) p[d.name] = d.defaultValue ?? '';
    }
    return { uid: uid(), code: '', name: `模具 ${i}`, materialCode: '', params: p, manuals: {} };
  }
  function seedPart(data: any, i: number, qtyDef: any = 0, qtyVar: string = qtyVarName): PartState {
    const p: Record<string, any> = {};
    for (const d of data.parameters ?? []) {
      if ((d.scope as string) === 'injection' && d.enabled !== false && d.name !== qtyVar) {
        p[d.name] = d.defaultValue ?? '';
      }
    }
    return { uid: uid(), code: '', name: `注塑件 ${i}`, materialCode: '', qty: qtyDef, params: p, manuals: {} };
  }

  function prefillFromSource(data: any, paramsJson: any) {
    const srcCommon = paramsJson.common ?? {};
    const qv = srcCommon.qtyVarName || resolveQtyVar(data);
    const qd = (data.parameters ?? []).find((x: any) => x.name === qv)?.defaultValue ?? 0;

    setCustomer({
      name: paramsJson.customerName || '',
      phone: paramsJson.customerPhone || '',
      productName: paramsJson.productName || '',
    });

    const nextCommon: Record<string, any> = {};
    for (const p of data.parameters ?? []) {
      if (p.enabled === false || (p.scope as string) !== 'common') continue;
      const raw = srcCommon.params?.[p.name];
      nextCommon[p.name] = raw !== undefined && raw !== '' ? raw : (p.defaultValue ?? '');
    }
    setCommonParams(nextCommon);

    const srcMolds: any[] = paramsJson.molds || [];
    if (srcMolds.length) {
      setMolds(
        srcMolds.map((m, i) => {
          const p: Record<string, any> = {};
          for (const d of data.parameters ?? []) {
            if ((d.scope as string) === 'mold' && d.enabled !== false) {
              const raw = m.params?.[d.name];
              p[d.name] = raw !== undefined && raw !== '' ? raw : (d.defaultValue ?? '');
            }
          }
          return {
            uid: uid(),
            code: m.code || '',
            name: m.name || `模具 ${i + 1}`,
            materialCode: m.materialCode || '',
            params: p,
            manuals: m.manualAmounts || {},
          };
        }),
      );
    } else {
      setMolds([seedMold(data, 1)]);
    }

    const srcParts: any[] = paramsJson.parts || [];
    if (srcParts.length) {
      setParts(
        srcParts.map((p, i) => {
          const pp: Record<string, any> = {};
          for (const d of data.parameters ?? []) {
            if ((d.scope as string) === 'injection' && d.enabled !== false && d.name !== qv) {
              const raw = p.params?.[d.name];
              pp[d.name] = raw !== undefined && raw !== '' ? raw : (d.defaultValue ?? '');
            }
          }
          return {
            uid: uid(),
            code: p.code || '',
            name: p.name || `注塑件 ${i + 1}`,
            materialCode: p.materialCode || '',
            qty: p.qty ?? qd,
            params: pp,
            manuals: p.manualAmounts || {},
          };
        }),
      );
    } else {
      setParts([seedPart(data, 1, qd, qv)]);
    }
  }

  // 实时算价
  const result = useMemo(() => {
    if (!cfg) return null;
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
    const coerce = (o: Record<string, any>) => {
      const r: Record<string, number> = {};
      for (const [k, v] of Object.entries(o ?? {})) {
        const n = Number(v);
        if (Number.isFinite(n)) r[k] = n;
      }
      return r;
    };
    const cParams = coerce(commonParams);
    const moldsIn = molds.map((m) => {
      const mp = coerce(m.params);
      // 选了钢材牌号 → 用材料库里的单价/密度/损耗率（覆盖整单公共参数）
      if (m.materialCode) {
        const mat = matByCode.get(m.materialCode);
        if (mat) {
          const dVar = moldSteelVars.densityVar;
          // 密度取「材料库的密度」优先（引擎会用它算重量），再退回整单参数/配置固定值
          const density =
            mat.density != null
              ? Number(mat.density)
              : Number(commonParams[dVar ?? '']) || Number(moldSteelVars.cfg?.density) || 0;
          // 阶梯价的用量口径 = 本套模具的钢材用量(kg)
          const weightKg = sizeWeightKg(moldSteelVars.cfg, { ...mp, ...(dVar ? { [dVar]: density } : {}) });
          if (moldSteelVars.priceVar) mp[moldSteelVars.priceVar] = pricePerKgOf(mat, weightKg);
          if (dVar && mat.density != null) mp[dVar] = Number(mat.density) || 0;
          if (moldSteelVars.lossVar && mat.lossRate != null)
            mp[moldSteelVars.lossVar] = Number(mat.lossRate) || 0;
        }
      }
      return {
        code: m.code || undefined,
        name: m.name,
        materialCode: m.materialCode || undefined,
        params: mp,
        manualAmounts: m.manuals,
      };
    });
    const partsIn = parts.map((p) => {
      const pp = coerce(p.params);
      // 选了牌号 → 单价与损耗率都按材料库走（与钢材同一套规则）
      if (p.materialCode) {
        const mat = matByCode.get(p.materialCode);
        if (mat) {
          // 阶梯价的用量口径 = 数量(件) × 单件重量(kg)
          const uw = Number(pp[injectionVars.wVar ?? '']);
          const consumptionKg =
            Number.isFinite(uw) && uw > 0 ? (Number(p.qty) || 0) * uw : null;
          if (injectionVars.priceVar) pp[injectionVars.priceVar] = pricePerKgOf(mat, consumptionKg);
          if (injectionVars.lossVar && mat.lossRate != null)
            pp[injectionVars.lossVar] = Number(mat.lossRate) || 0;
        }
      }
      return {
        code: p.code || undefined,
        name: p.name,
        materialCode: p.materialCode || undefined,
        qty: Number(p.qty) || 0,
        params: pp,
        manualAmounts: p.manuals,
      };
    });
    return calculateQuoteProject({
      items: defs,
      common: {
        profitRate: cfg.moldType?.profitRate ?? 0.1,
        taxRate: cfg.moldType?.taxRate ?? 0.13,
        qtyVarName,
        params: cParams,
      },
      molds: moldsIn,
      parts: partsIn,
    });
  }, [cfg, commonParams, molds, parts, matByCode, injectionPriceVar, moldSteelVars, qtyVarName]);

  const submit = async () => {
    if (!cfg) return;
    if (!customer.name.trim()) return alert('请填写客户名称');
    setSaving(true);
    try {
      const coerce = (o: Record<string, any>) => {
        const r: Record<string, number> = {};
        for (const [k, v] of Object.entries(o ?? {})) {
          const n = Number(v);
          if (Number.isFinite(n)) r[k] = n;
        }
        return r;
      };
      const created = await quotes.createProject({
        moldTypeId: cfg.moldType.id,
        customerName: customer.name.trim(),
        customerPhone: customer.phone.trim() || undefined,
        productName: customer.productName.trim() || undefined,
        common: {
          profitRate: cfg.moldType.profitRate,
          taxRate: cfg.moldType.taxRate,
          qtyVarName,
          params: coerce(commonParams),
        },
        molds: molds.map((m) => ({
          code: m.code || undefined,
          name: m.name,
          materialCode: m.materialCode || undefined,
          params: coerce(m.params),
          manualAmounts: m.manuals,
        })),
        parts: parts.map((p) => ({
          code: p.code || undefined,
          name: p.name,
          materialCode: p.materialCode || undefined,
          qty: Number(p.qty) || 0,
          params: coerce(p.params),
          manualAmounts: p.manuals,
        })),
      });
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

  const setMold = (i: number, patch: Partial<MoldState>) =>
    setMolds((arr) => arr.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  const setPart = (i: number, patch: Partial<PartState>) =>
    setParts((arr) => arr.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const copyMold = (i: number) =>
    setMolds((arr) => [...arr, { ...arr[i], uid: uid(), name: arr[i].name + ' 副本', manuals: { ...arr[i].manuals } }]);
  const copyPart = (i: number) =>
    setParts((arr) => [...arr, { ...arr[i], uid: uid(), name: arr[i].name + ' 副本', manuals: { ...arr[i].manuals } }]);

  const renderParamInput = (p: any, value: any, onChange: (v: any) => void) => {
    const opts: any[] = Array.isArray(p.options) ? p.options : [];
    const isSel = p.type === 'select' && opts.length > 0;
    if (isSel) {
      return (
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full border border-emerald-300 bg-emerald-50 text-emerald-900 rounded px-2.5 py-2 text-sm"
        >
          {opts.map((o, oi) => (
            <option key={oi} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        type="number"
        step="any"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-gray-300 rounded px-2.5 py-2 text-sm text-right tabular-nums"
      />
    );
  };

  return (
    <div className="max-w-[1600px] mx-auto p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold">{copyFrom ? '按此版本重新报价' : '新建报价单（多注塑件）'}</h1>
          <p className="text-sm text-gray-500 mt-1">
            一套报价单可含多套模具（并列）+ 多个注塑件（并列），整单统一利润与税
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={saving}
            className="bg-gray-900 text-white px-4 py-2 rounded text-sm font-medium hover:bg-gray-800"
          >
            {saving ? '生成中…' : '生成报价单'}
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

      <div className="grid gap-3.5 items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) 400px' }}>
        {/* 左：填数据 */}
        <div className="space-y-3.5">
          {/* 客户信息 */}
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
                <span className="text-gray-500">客户电话</span>
                <input
                  value={customer.phone}
                  onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2.5 py-2 text-sm"
                  placeholder="如：13800138000"
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

          {/* 公共参数 */}
          {commonDefs.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg">
              <div className="px-3.5 py-3 border-b border-gray-200 font-semibold text-sm">
                公共参数（整单共享）
              </div>
              <div className="p-3.5 grid grid-cols-3 gap-x-4 gap-y-3">
                {commonDefs.map((p) => (
                  <label key={p.id ?? p.name} className="text-sm">
                    <span className="text-gray-500">
                      {p.name}
                      {p.unit && <span className="text-gray-400 text-xs"> ({p.unit})</span>}
                    </span>
                    {renderParamInput(
                      p,
                      commonParams[p.name],
                      (v) => setCommonParams((s) => ({ ...s, [p.name]: v })),
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* 模具列表 */}
          <div className="bg-white border border-gray-200 rounded-lg">
            <div className="px-3.5 py-3 border-b border-gray-200 flex items-center justify-between">
              <span className="font-semibold text-sm">模具（{molds.length} 套）</span>
              <button
                onClick={() => setMolds((arr) => [...arr, seedMold(cfg, arr.length + 1)])}
                className="text-xs bg-gray-900 text-white px-2.5 py-1 rounded hover:bg-gray-800"
              >
                + 加一套模具
              </button>
            </div>
            <div className="p-3.5 space-y-3">
              {molds.map((m, i) => (
                <div key={m.uid} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      value={m.name}
                      onChange={(e) => setMold(i, { name: e.target.value })}
                      className="text-sm font-medium border border-transparent hover:border-gray-300 rounded px-1.5 py-1 w-40"
                    />
                    <input
                      value={m.code}
                      onChange={(e) => setMold(i, { code: e.target.value })}
                      className="text-xs text-gray-500 border border-gray-300 rounded px-2 py-1 w-28"
                      placeholder="编码(可选)"
                    />
                    <div className="flex-1" />
                    <button onClick={() => copyMold(i)} className="text-xs text-gray-500 hover:text-gray-900">复制</button>
                    <button
                      onClick={() => setMolds((arr) => arr.filter((_, idx) => idx !== i))}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      删除
                    </button>
                  </div>
                  {moldSteelVars.priceVar && (
                    <div className="grid grid-cols-3 gap-x-4 gap-y-3 mb-3">
                      <label className="text-sm">
                        <span className="text-gray-500">模具钢材（来自材料库）</span>
                        <select
                          value={m.materialCode}
                          onChange={(e) => setMold(i, { materialCode: e.target.value })}
                          className="mt-1 w-full border border-gray-300 rounded px-2.5 py-2 text-sm"
                        >
                          <option value="">
                            {steelGroups.length
                              ? `— 不选（按整单「${moldSteelVars.priceVar}」计）—`
                              : '— 材料库暂无可用钢材（请到材料中心维护或在下方直接填单价）—'}
                          </option>
                          {steelGroups.map(([cat, list]) => (
                            <optgroup key={cat} label={cat}>
                              {list.map((s) => (
                                <option key={s.code} value={s.code}>
                                  {s.name} · ¥{s.currentPrice}/{s.unit || 'kg'}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        {(() => {
                          const s = m.materialCode ? matByCode.get(m.materialCode) : null;
                          return s ? (
                            <span className="text-[11px] text-emerald-700">
                              ¥{pricePerKgOf(s).toLocaleString('zh-CN', { maximumFractionDigits: 4 })}/kg
                              {s.density ? ` · 密度 ${s.density}` : ''}
                              {s.lossRate != null ? ` · 损耗 ${Math.round(s.lossRate * 1000) / 10}%` : ''}
                            </span>
                          ) : (
                            <span className="text-[11px] text-gray-400">不选则按整单钢材单价计</span>
                          );
                        })()}
                      </label>
                    </div>
                  )}
                  {moldDefs.length > 0 && (
                    <div className="grid grid-cols-3 gap-x-4 gap-y-3">
                      {moldDefs.map((p) => (
                        <label key={p.id ?? p.name} className="text-sm">
                          <span className="text-gray-500">
                            {p.name}
                            {p.unit && <span className="text-gray-400 text-xs"> ({p.unit})</span>}
                          </span>
                          {renderParamInput(
                            p,
                            m.params[p.name],
                            (v) => setMold(i, { params: { ...m.params, [p.name]: v } }),
                          )}
                        </label>
                      ))}
                    </div>
                  )}
                  {manualMoldItems.length > 0 && (
                    <div className="grid grid-cols-3 gap-x-4 gap-y-3 mt-3 pt-3 border-t border-gray-100">
                      {manualMoldItems.map((it: any) => (
                        <label key={it.id ?? it.name} className="text-sm">
                          <span className="text-gray-500">{it.name}（元）</span>
                          <input
                            type="number"
                            step="any"
                            value={m.manuals[it.name] ?? ''}
                            onChange={(e) =>
                              setMold(i, { manuals: { ...m.manuals, [it.name]: Number(e.target.value) } })
                            }
                            className="mt-1 w-full border border-gray-300 rounded px-2.5 py-2 text-sm text-right tabular-nums"
                            placeholder="0"
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {molds.length === 0 && (
                <p className="text-center text-gray-400 text-sm py-4">暂无模具，点右上角「加一套模具」</p>
              )}
            </div>
          </div>

          {/* 注塑件列表 */}
          <div className="bg-white border border-gray-200 rounded-lg">
            <div className="px-3.5 py-3 border-b border-gray-200 flex items-center justify-between">
              <span className="font-semibold text-sm">注塑件（{parts.length} 个）</span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setParts((arr) => [...arr, seedPart(cfg, arr.length + 1)])}
                  className="text-xs bg-gray-900 text-white px-2.5 py-1 rounded hover:bg-gray-800"
                >
                  + 加 1 件
                </button>
                <button
                  onClick={() =>
                    setParts((arr) => [
                      ...arr,
                      ...Array.from({ length: 5 }, (_, k) => seedPart(cfg, arr.length + k + 1)),
                    ])
                  }
                  className="text-xs border border-gray-300 px-2.5 py-1 rounded hover:bg-gray-50"
                >
                  + 批量 5 件
                </button>
              </div>
            </div>
            <div className="p-3.5 space-y-3">
              {parts.map((p, i) => (
                <div key={p.uid} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      value={p.name}
                      onChange={(e) => setPart(i, { name: e.target.value })}
                      className="text-sm font-medium border border-transparent hover:border-gray-300 rounded px-1.5 py-1 w-40"
                    />
                    <input
                      value={p.code}
                      onChange={(e) => setPart(i, { code: e.target.value })}
                      className="text-xs text-gray-500 border border-gray-300 rounded px-2 py-1 w-28"
                      placeholder="编码(可选)"
                    />
                    <div className="flex-1" />
                    <button onClick={() => copyPart(i)} className="text-xs text-gray-500 hover:text-gray-900">复制</button>
                    <button
                      onClick={() => setParts((arr) => arr.filter((_, idx) => idx !== i))}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      删除
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-x-4 gap-y-3">
                    {/* 材料 */}
                    <label className="text-sm">
                      <span className="text-gray-500">材料（来自材料库）</span>
                      <select
                        value={p.materialCode}
                        onChange={(e) => setPart(i, { materialCode: e.target.value })}
                        className="mt-1 w-full border border-indigo-300 bg-indigo-50 text-indigo-900 rounded px-2.5 py-2 text-sm"
                      >
                        <option value="">— 不选 —</option>
                        {/* 注塑件/压铸件只该选塑料或合金；钢材属于模具，不在这里出现 */}
                        {['塑料原料', '压铸合金'].map((cat) => {
                          const group = usableMaterials.filter((m) => m.category === cat);
                          if (!group.length) return null;
                          return (
                            <optgroup key={cat} label={cat}>
                              {group.map((m) => (
                                <option key={m.id} value={m.code}>
                                  {m.name}（¥{Number(m.currentPrice).toLocaleString('zh-CN')}/{m.unit}
                                  {m.lossRate != null ? ` · 损耗 ${Math.round(m.lossRate * 100)}%` : ''}）
                                </option>
                              ))}
                            </optgroup>
                          );
                        })}
                      </select>
                      {p.materialCode && matByCode.get(p.materialCode) && injectionVars.priceVar && (
                        <div className="text-[12px] text-indigo-700 mt-1">
                          {injectionVars.priceVar}：¥{pricePerKgOf(matByCode.get(p.materialCode)).toLocaleString('zh-CN', { maximumFractionDigits: 4 })}/kg
                          {matByCode.get(p.materialCode).lossRate != null
                            ? ` · 损耗 ${Math.round(matByCode.get(p.materialCode).lossRate * 100)}%`
                            : ''}
                          （材料库带入）
                        </div>
                      )}
                    </label>
                    {/* 数量 */}
                    <label className="text-sm">
                      <span className="text-gray-500">数量（{cfg?.parameters?.find((x:any)=>x.name===qtyVarName)?.unit ?? '件'}）</span>
                      <input
                        type="number"
                        step="any"
                        value={p.qty ?? ''}
                        onChange={(e) => setPart(i, { qty: e.target.value })}
                        className="mt-1 w-full border border-gray-300 rounded px-2.5 py-2 text-sm text-right tabular-nums"
                      />
                    </label>
                    {/* 其它注塑参数（排除数量项与材料价项） */}
                    {injectionDefs
                      .filter((d) => d.name !== qtyVarName && d.name !== injectionPriceVar)
                      .map((d) => (
                        <label key={d.id ?? d.name} className="text-sm">
                          <span className="text-gray-500">
                            {d.name}
                            {d.unit && <span className="text-gray-400 text-xs"> ({d.unit})</span>}
                          </span>
                          {renderParamInput(
                            d,
                            p.params[d.name],
                            (v) => setPart(i, { params: { ...p.params, [d.name]: v } }),
                          )}
                        </label>
                      ))}
                  </div>
                  {manualInjItems.length > 0 && (
                    <div className="grid grid-cols-3 gap-x-4 gap-y-3 mt-3 pt-3 border-t border-gray-100">
                      {manualInjItems.map((it: any) => (
                        <label key={it.id ?? it.name} className="text-sm">
                          <span className="text-gray-500">{it.name}（元/件）</span>
                          <input
                            type="number"
                            step="any"
                            value={p.manuals[it.name] ?? ''}
                            onChange={(e) =>
                              setPart(i, { manuals: { ...p.manuals, [it.name]: Number(e.target.value) } })
                            }
                            className="mt-1 w-full border border-gray-300 rounded px-2.5 py-2 text-sm text-right tabular-nums"
                            placeholder="0"
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {parts.length === 0 && (
                <p className="text-center text-gray-400 text-sm py-4">暂无注塑件，点右上角「加 1 件」</p>
              )}
            </div>
          </div>
        </div>

        {/* 右：实时算价 */}
        <div className="bg-white border border-gray-200 rounded-lg sticky top-4">
          <div className="px-3.5 py-3 border-b border-gray-200 font-semibold text-sm">实时算价</div>
          <div className="px-3.5 pt-2 pb-1 text-[11.5px] text-gray-400">
            点「费用明细」可看到每一项是怎么算出来的，改任何参数都能对上账
          </div>
          <div className="p-3.5 pt-1.5 max-h-[520px] overflow-y-auto">
            <div className="text-[12px] font-semibold text-gray-500 mb-1">模具费用</div>
            {(result?.moldResults ?? []).map((m: any, i: number) => (
              <div key={i} className="py-1">
                <div className="flex justify-between text-[13px]">
                  <span className="text-gray-700 truncate pr-2">{m.name}</span>
                  <span className="tabular-nums font-medium">{money(m.subtotal)}</span>
                </div>
                <button
                  onClick={() => setDetailOpen((s) => ({ ...s, [`m${i}`]: !s[`m${i}`] }))}
                  className="text-[11px] text-gray-400 hover:text-gray-900"
                >
                  {detailOpen[`m${i}`] ? '▴ 收起明细' : '▾ 费用明细'}
                </button>
                {detailOpen[`m${i}`] && (
                  <div className="mt-1 mb-1 space-y-0.5 border-l-2 border-gray-100 pl-2">
                    {(m.lines ?? [])
                      .filter((l: any) => !l.skipped)
                      .map((l: any, li: number) => (
                        <div key={li} className="flex justify-between text-[11.5px] text-gray-500 gap-2">
                          <span className="truncate">{l.name}</span>
                          <span className="tabular-nums shrink-0">
                            {l.error ? '—' : l.manual ? '报价时填' : money(l.value)}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ))}
            {molds.length === 0 && <div className="text-[12.5px] text-gray-400">—</div>}

            <div className="text-[12px] font-semibold text-gray-500 mt-3 mb-1">注塑费用</div>
            {(result?.partResults ?? []).map((p: any, i: number) => (
              <div key={i} className="py-1">
                <div className="flex justify-between text-[13px]">
                  <span className="text-gray-700 truncate pr-2">{p.name}</span>
                  <span className="tabular-nums font-medium">{money(p.total)}</span>
                </div>
                {p.unitCost != null && (
                  <div className="text-[12px] text-emerald-700">
                    单件 {money2(p.unitCost)}　×　{(p.qty ?? 0).toLocaleString('zh-CN')} 件
                  </div>
                )}
                <button
                  onClick={() => setDetailOpen((s) => ({ ...s, [`p${i}`]: !s[`p${i}`] }))}
                  className="text-[11px] text-gray-400 hover:text-gray-900"
                >
                  {detailOpen[`p${i}`] ? '▴ 收起明细' : '▾ 费用明细'}
                </button>
                {detailOpen[`p${i}`] && (
                  <div className="mt-1 mb-1 space-y-0.5 border-l-2 border-gray-100 pl-2">
                    {(p.lines ?? [])
                      .filter((l: any) => !l.skipped)
                      .map((l: any, li: number) => (
                        <div key={li} className="flex justify-between text-[11.5px] text-gray-500 gap-2">
                          <span className="truncate">{l.name}</span>
                          <span className="tabular-nums shrink-0">
                            {l.error ? '—' : l.manual ? '报价时填' : money(l.value)}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ))}
            {parts.length === 0 && <div className="text-[12.5px] text-gray-400">—</div>}

            {(result?.moldResults ?? []).some((m: any) =>
              (m.lines ?? []).some((l: any) => l.error),
            ) && (
              <div className="text-[12.5px] text-red-600 mt-2">部分费用项缺参数，请检查标红项</div>
            )}
          </div>
          <div className="bg-gray-50 border-t border-gray-200 px-3.5 py-3">
            <div className="flex justify-between text-[13px] text-gray-600 py-0.5">
              <span>模具合计</span>
              <span className="tabular-nums">{money(result?.moldSubtotal ?? 0)}</span>
            </div>
            <div className="flex justify-between text-[13px] text-gray-600 py-0.5">
              <span>注塑合计</span>
              <span className="tabular-nums">{money(result?.injectionSubtotal ?? 0)}</span>
            </div>
            <div className="flex justify-between text-[13px] text-gray-600 py-0.5">
              <span>不含税小计</span>
              <span className="tabular-nums">{money(result?.subtotal ?? 0)}</span>
            </div>
            <div className="flex justify-between text-[13px] text-gray-600 py-0.5">
              <span>利润（{Math.round((result?.profitRate ?? 0) * 1000) / 10}%）</span>
              <span className="tabular-nums">{money(result?.profit ?? 0)}</span>
            </div>
            <div className="flex justify-between text-[13px] text-gray-600 py-0.5">
              <span>税额（{Math.round((result?.taxRate ?? 0) * 1000) / 10}%）</span>
              <span className="tabular-nums">{money(result?.tax ?? 0)}</span>
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
