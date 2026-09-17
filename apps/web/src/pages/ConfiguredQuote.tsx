import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SmartImport, type ApplyItem } from '../components/SmartImport';
import { configApi, materials as materialsApi, quotes, uploads, type QuoteImage } from '../api';
import { uploadImage, humanSize } from '../utils/image';
import { applyImportedParams } from '../utils/importParams';
import { useFeedback } from '../components/feedback';
import { calculateQuoteProject } from '@mqs/calc-engine';
import type { QuoteItemDef, ExtraItem, QuoteExtras } from '@mqs/shared';
import { QTY_VAR_CANDIDATES, resolveMaterialPrice } from '@mqs/shared';

const money = (n: number) => '¥ ' + Math.round(n || 0).toLocaleString('zh-CN');
const money2 = (n: number) =>
  '¥ ' + (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const uid = () => Math.random().toString(36).slice(2, 9);

// 动态附加费用编辑器（现仅「其他价格」板块使用）
function ExtrasEditor({
  title,
  unitHint,
  items,
  onAdd,
  onRemove,
  onChange,
}: {
  title: string;
  unitHint?: string;
  items: ExtraItem[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<ExtraItem>) => void;
}) {
  const total = items.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/60 p-3">
      {(title || unitHint) && (
        <div className="flex items-center justify-between mb-2">
          <div className="text-[13px] font-medium text-gray-700">
            {title}
            {unitHint && <span className="ml-1 text-[11px] text-gray-400 font-normal">{unitHint}</span>}
          </div>
          <div className="text-[12px] text-gray-500">小计 {money(total)}</div>
        </div>
      )}
      {items.length === 0 ? (
        <div className="text-[12px] text-gray-400 mb-2">暂无费用，点右上方「+ 新增费用」添加一行</div>
      ) : (
        <div className="space-y-2 mb-2">
          {items.map((e) => (
            <div key={e.id} className="flex items-center gap-2">
              <input
                value={e.name}
                onChange={(ev) => onChange(e.id, { name: ev.target.value })}
                placeholder="费用名称"
                className="flex-1 min-w-0 border border-gray-300 rounded px-2 py-1.5 text-[13px]"
              />
              <input
                type="number"
                step="any"
                value={e.amount}
                onChange={(ev) => onChange(e.id, { amount: Number(ev.target.value) || 0 })}
                placeholder="金额"
                className="w-24 border border-gray-300 rounded px-2 py-1.5 text-[13px] text-right tabular-nums"
              />
              <input
                value={e.note ?? ''}
                onChange={(ev) => onChange(e.id, { note: ev.target.value })}
                placeholder="备注"
                className="flex-1 min-w-0 border border-gray-300 rounded px-2 py-1.5 text-[13px]"
              />
              <button
                type="button"
                onClick={() => onRemove(e.id)}
                className="shrink-0 text-[12px] text-red-500 hover:text-red-700 px-1"
                title="删除这一行"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={onAdd}
        className="text-[12px] border border-gray-300 bg-white px-2.5 py-1 rounded hover:bg-gray-100"
      >
        + 新增费用
      </button>
    </div>
  );
}

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
  /**
   * 「不纳入计算」开关：键 = 参数名或手填费用项名，true 表示这一栏先不算钱。
   * 值仍保留在页面上，只是送进算价时按 0 处理（导出的 Excel 也不会出现这一行）。
   */
  off: Record<string, boolean>;
  manuals: Record<string, number>;
  /** 件图：这一套模具对应的图纸/实物照片，会一起导出到 Excel 报价单 */
  image?: QuoteImage | null;
}
interface PartState {
  uid: string;
  code: string;
  name: string;
  materialCode: string;
  qty: any;
  params: Record<string, any>;
  /** 同 MoldState.off */
  off: Record<string, boolean>;
  manuals: Record<string, number>;
  /** 件图：这一个注塑件的图纸/实物照片 */
  image?: QuoteImage | null;
}

/**
 * 「纳入 / 不纳入计算」小开关。
 *
 * 为什么要它：有些参数（模架、热流道、EDM…）这次报价根本不涉及，
 * 以前只能把值改成 0，既麻烦又分不清「真的是 0」还是「不想算」。
 * 默认全部「纳入」；点一下变「不纳入」，值留着但不参与算价。
 */
function OffToggle({ off, onToggle }: { off: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={
        off
          ? '当前「不纳入计算」——这一栏不参与算价，点击恢复纳入'
          : '点击设为「不纳入计算」——值保留，但不参与算价、也不出现在导出的报价表上'
      }
      className={`shrink-0 text-[10.5px] leading-none px-1.5 py-[3px] rounded border transition ${
        off
          ? 'border-gray-300 bg-gray-100 text-gray-500 hover:bg-gray-200'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
      }`}
    >
      {off ? '不纳入' : '纳入'}
    </button>
  );
}

/**
 * 件图槽 —— 卡片上的缩略图 + 上传 / 替换 / 删除 / 放大查看。
 *
 * 这是「手点上传」的**兜底通道**：二期会从 Excel 内嵌图、3D 渲染图批量灌进来，
 * 两条路都走 utils/image 里的 uploadImage()，所以这里只负责交互，
 * 压缩 / 转码 / 格式兼容一概不在这里管。
 */
function ImageSlot({
  image,
  onChange,
  onError,
  onInfo,
  size = 48,
}: {
  image?: QuoteImage | null;
  onChange: (img: QuoteImage | null) => void;
  onError: (msg: string) => void;
  onInfo?: (msg: string) => void;
  size?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [zoom, setZoom] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const take = async (f?: File | null) => {
    if (!f) return;
    setBusy(true);
    try {
      const img = await uploadImage(f, { source: 'upload' });
      onChange(img);
      onInfo?.(`件图已上传（${humanSize(f.size)}）`);
    } catch (e: any) {
      onError(e?.response?.data?.error || e?.message || '图片上传失败');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const clear = () => {
    const old = image?.url;
    onChange(null);
    // 文件删除失败不影响业务（报价单里已经不引用了）
    if (old) uploads.remove(old).catch(() => {});
  };

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
        setDragOver(true);
      }
    },
    onDragLeave: () => setDragOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      if (files.length > 1) onInfo?.(`一次只能放一张，已取「${files[0].name}」`);
      take(files[0]);
    },
  };

  return (
    <div className="shrink-0" {...dropProps}>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
        className="hidden"
        onChange={(e) => take(e.target.files?.[0])}
      />

      {image?.url ? (
        <div className="relative group" style={{ width: size, height: size }}>
          <img
            src={image.url}
            alt={image.name || '件图'}
            title={`${image.name || '件图'}（点击放大 / 拖入新图可替换）`}
            className={`w-full h-full object-contain bg-white border rounded cursor-zoom-in transition ${
              dragOver ? 'border-emerald-500 ring-2 ring-emerald-200' : 'border-gray-200'
            }`}
            onClick={() => setZoom(true)}
          />
          <div className="absolute inset-0 hidden group-hover:flex items-center justify-center gap-1 bg-black/45 rounded pointer-events-none">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="pointer-events-auto text-[10.5px] text-white px-1.5 py-0.5 rounded bg-white/20 hover:bg-white/30"
            >
              换
            </button>
            <button
              type="button"
              onClick={clear}
              className="pointer-events-auto text-[10.5px] text-white px-1.5 py-0.5 rounded bg-white/20 hover:bg-white/30"
            >
              删
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          title="点这里选图，或直接把图片拖进来（会一起导到 Excel 报价单）"
          style={{ width: size, height: size }}
          className={`flex items-center justify-center border border-dashed rounded transition disabled:opacity-50 ${
            dragOver
              ? 'border-emerald-500 bg-emerald-50 text-emerald-600'
              : 'border-gray-300 text-gray-400 hover:border-emerald-400 hover:text-emerald-600'
          }`}
        >
          <span className="text-[11px] leading-none text-center">
            {busy ? '上传中' : dragOver ? '放开' : '＋ 件图'}
          </span>
        </button>
      )}

      {zoom && image?.url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8"
          onClick={() => setZoom(false)}
        >
          <div className="max-w-[92vw] max-h-[92vh] bg-white rounded-lg p-3" onClick={(e) => e.stopPropagation()}>
            <img
              src={image.url}
              alt={image.name || '件图'}
              className="max-w-[86vw] max-h-[80vh] object-contain"
            />
            <div className="mt-2 flex items-center justify-between gap-4 text-xs text-gray-500">
              <span className="truncate">{image.name || '件图'}</span>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setZoom(false);
                    inputRef.current?.click();
                  }}
                  className="text-gray-600 hover:text-gray-900"
                >
                  换一张
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setZoom(false);
                    clear();
                  }}
                  className="text-red-500 hover:text-red-700"
                >
                  删除
                </button>
                <button type="button" onClick={() => setZoom(false)} className="text-gray-600 hover:text-gray-900">
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ConfiguredQuote() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();

  const [types, setTypes] = useState<any[]>([]);
  const [activeId, setActiveId] = useState('');
  const [cfg, setCfg] = useState<any | null>(null);
  const [commonParams, setCommonParams] = useState<Record<string, any>>({});
  /** 公共参数的「不纳入计算」开关 */
  const [commonOff, setCommonOff] = useState<Record<string, boolean>>({});
  const [molds, setMolds] = useState<MoldState[]>([]);
  const [parts, setParts] = useState<PartState[]>([]);
  const [customer, setCustomer] = useState({ name: '', phone: '', productName: '' });
  const [extras, setExtras] = useState<QuoteExtras>({ moldExtras: [], injectionExtras: [], otherExtras: [] });
  const [matList, setMatList] = useState<any[]>([]);
  /** 右栏「费用明细」展开状态（m0/m1=模具，p0/p1=注塑件） */
  const [detailOpen, setDetailOpen] = useState<Record<string, boolean>>({});
  /** 左栏表单分区折叠：customer / common / molds / parts */
  const [secOpen, setSecOpen] = useState<Record<string, boolean>>({
    customer: true,
    common: true,
    molds: true,
    parts: true,
  });
  const toggleSec = (k: string) => setSecOpen((s) => ({ ...s, [k]: !s[k] }));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const fb = useFeedback();
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
          setCommonOff({});
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
  const moldDefs = useMemo(() => params.filter((p) => (p.scope as string) === 'mold'), [cfg]);
  const injectionDefs = useMemo(() => params.filter((p) => (p.scope as string) === 'injection'), [cfg]);

  /**
   * 整单参数区（放在最底下「其他价格」板块里）。
   *
   * 规则：整单（scope=common）参数里，**只放需要业务选择的那一类** ——
   * 也就是「运输区域」这种下拉。运输箱长/宽/高、运费单价是内部计价参数，
   * 不在报价单上占位置（值仍在库里，按配置中心的默认值参与算价）。
   *
   * 这样以后在配置中心新增一个「运输/整单」类下拉参数，报价单会自动出现，
   * 不需要改报价页代码；而新增数字类计价参数不会跑到报价页上打扰人。
   */
  const commonDefs = useMemo(
    () =>
      (cfg?.parameters ?? []).filter(
        (p: any) =>
          p.enabled !== false &&
          (p.scope as string) === 'common' &&
          (p.name === '运输区域' || (p.group === '运输' && p.type === 'select')),
      ),
    [cfg],
  );

  /**
   * 配置中心「要收哪些费用」里、类型是「手填金额」的项 —— 这些要在报价页填。
   *
   * 只留手填类：公式类（模芯钢材费 / CNC / 设计费…）不在这儿铺开，
   * 它们的金额看右侧「实时算价 → 费用明细」就够，铺一堆 ¥0 / 未设值 只会让卡片变吵。
   * 手填类必须有输入框，否则配置中心里设成「手填金额」的项在报价页根本没地方填
   * （落到 state.manuals，随报价单一起存）。
   */
  const manualItems = (scope: 'mold' | 'injection') =>
    (cfg?.items ?? []).filter(
      (it: any) => it.scope === scope && it.enabled !== false && it.calcType === 'manual',
    );

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

  const matByCode = useMemo(() => new Map(matList.map((m) => [m.code, m])), [matList]);

  // —— 其他价格（整单级动态增删）。模具 / 注塑 两处附加费板块已按需求移除，
  //    但数据模型保留 moldExtras / injectionExtras，老报价照样能算、能回显 ——
  const addExtra = (bucket: keyof QuoteExtras) =>
    setExtras((e) => ({
      ...e,
      [bucket]: [...(e[bucket] ?? []), { id: uid(), name: '', amount: 0, note: '' }],
    }));
  const removeExtra = (bucket: keyof QuoteExtras, id: string) =>
    setExtras((e) => ({ ...e, [bucket]: (e[bucket] ?? []).filter((x) => x.id !== id) }));
  const patchExtra = (bucket: keyof QuoteExtras, id: string, patch: Partial<ExtraItem>) =>
    setExtras((e) => ({
      ...e,
      [bucket]: (e[bucket] ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)),
    }));

  function seedMold(data: any, i: number): MoldState {
    const p: Record<string, any> = {};
    for (const d of data.parameters ?? []) {
      if ((d.scope as string) === 'mold' && d.enabled !== false) p[d.name] = d.defaultValue ?? '';
    }
    return { uid: uid(), code: '', name: `模具 ${i}`, materialCode: '', params: p, off: {}, manuals: {}, image: null };
  }
  function seedPart(data: any, i: number, qtyDef: any = 0, qtyVar: string = qtyVarName): PartState {
    const p: Record<string, any> = {};
    for (const d of data.parameters ?? []) {
      if ((d.scope as string) === 'injection' && d.enabled !== false && d.name !== qtyVar) {
        p[d.name] = d.defaultValue ?? '';
      }
    }
    return { uid: uid(), code: '', name: `注塑件 ${i}`, materialCode: '', qty: qtyDef, params: p, off: {}, manuals: {}, image: null };
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
    setCommonOff(srcCommon.off || {});

    const srcMolds: any[] = paramsJson.molds || [];
    if (srcMolds.length) {
      setMolds(
        srcMolds.map((m, i) => {
          const p: Record<string, any> = {};
          for (const d of data.parameters ?? []) {
            if ((d.scope as string) === 'mold' && d.enabled !== false) {
              // 兼容老报价单：早期「腔数 / 钢材单价 / 钢材密度 / 钢材损耗率」存在整单公共参数里，
              // 后来改到模具作用域。这里回落到旧位置取值，避免重新打开时丢成默认值。
              const raw = m.params?.[d.name] ?? srcCommon.params?.[d.name];
              p[d.name] = raw !== undefined && raw !== '' ? raw : (d.defaultValue ?? '');
            }
          }
          return {
            uid: uid(),
            code: m.code || '',
            name: m.name || `模具 ${i + 1}`,
            materialCode: m.materialCode || '',
            params: p,
            off: m.off || {},
            manuals: m.manualAmounts || {},
            image: m.image ?? null,
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
            off: p.off || {},
            manuals: p.manualAmounts || {},
            image: p.image ?? null,
          };
        }),
      );
    } else {
      setParts([seedPart(data, 1, qd, qv)]);
    }

    // 回显已保存的附加费用（老报价可能仍带着模具 / 注塑附加费，原样保留以便继续算价）
    setExtras(
      paramsJson.extras ?? { moldExtras: [], injectionExtras: [], otherExtras: [] },
    );
  }

  /**
   * 组装送进算价的参数 —— **预览与保存共用这一套**。
   * （以前预览和提交各写一份，材料价一变就会出现「预览一个价、保存另一个价」。）
   *
   * 取值顺序：
   *   1) 勾了「不纳入计算」的字段 → 按 0 计（值仍留在页面上，只是不参与算钱）
   *   2) 选了材料牌号 → 单价/密度按材料库（价格模式 B：材料库是唯一价格来源）
   *   3) 损耗率**不覆盖** —— 选牌号时已作为默认值带进输入框，用户改过就以用户为准
   */
  const calcInput = useMemo(() => {
    const coerce = (o: Record<string, any>) => {
      const r: Record<string, number> = {};
      for (const [k, v] of Object.entries(o ?? {})) {
        const n = Number(v);
        if (Number.isFinite(n)) r[k] = n;
      }
      return r;
    };
    /** 手填费用项：勾了「不纳入」的直接不传 → 引擎按 0 计 */
    const keepManuals = (manuals: Record<string, any>, off: Record<string, boolean>) =>
      Object.fromEntries(Object.entries(manuals ?? {}).filter(([k]) => !off?.[k]));

    const cParams = coerce(commonParams);
    for (const [k, v] of Object.entries(commonOff ?? {})) if (v) cParams[k] = 0;

    const moldsIn = molds.map((m) => {
      const mp = coerce(m.params);
      for (const [k, v] of Object.entries(m.off ?? {})) if (v) mp[k] = 0;

      // 前/后模钢材：参数里存的是「材料编码」，这里换成材料库现价。
      // 阶梯价按本套模具的钢材用量取，与「钢材单价」同一套逻辑，保证单价口径一致；
      // 没选（空/0）时不写入，引擎会回落到「钢材单价」。
      const steelKeys = (moldSteelVars.cfg?.priceVars as string[] | undefined) ?? [];
      if (steelKeys.length) {
        const w = sizeWeightKg(moldSteelVars.cfg, mp);
        for (const key of steelKeys) {
          if (m.off?.[key]) continue;
          const mat = matByCode.get(String(m.params?.[key] ?? ''));
          if (mat) mp[key] = pricePerKgOf(mat, w);
        }
      }

      if (m.materialCode) {
        const mat = matByCode.get(m.materialCode);
        if (mat) {
          const dVar = moldSteelVars.densityVar;
          // 密度取「材料库的密度」优先（引擎会用它算重量）；
          // 没接材料库时先看本套模具填的密度，再回落到整单公共参数与配置固定值。
          const density =
            mat.density != null
              ? Number(mat.density)
              : Number(mp[dVar ?? '']) ||
                Number(commonParams[dVar ?? '']) ||
                Number(moldSteelVars.cfg?.density) ||
                0;
          // 阶梯价的用量口径 = 本套模具的钢材用量(kg)
          const weightKg = sizeWeightKg(moldSteelVars.cfg, { ...mp, ...(dVar ? { [dVar]: density } : {}) });
          if (moldSteelVars.priceVar && !m.off[moldSteelVars.priceVar]) {
            mp[moldSteelVars.priceVar] = pricePerKgOf(mat, weightKg);
          }
          if (dVar && mat.density != null && !m.off[dVar]) mp[dVar] = Number(mat.density) || 0;
        }
      }
      return {
        code: m.code || undefined,
        name: m.name,
        materialCode: m.materialCode || undefined,
        params: mp,
        manualAmounts: keepManuals(m.manuals, m.off),
      };
    });

    const partsIn = parts.map((p) => {
      const pp = coerce(p.params);
      for (const [k, v] of Object.entries(p.off ?? {})) if (v) pp[k] = 0;
      // 选了牌号 → 单价按材料库（价格模式 B）；损耗率交给输入框，不再覆盖
      if (p.materialCode) {
        const mat = matByCode.get(p.materialCode);
        if (mat) {
          // 阶梯价的用量口径 = 数量(件) × 单件重量(kg)
          const uw = Number(pp[injectionVars.wVar ?? '']);
          const consumptionKg =
            Number.isFinite(uw) && uw > 0 ? (Number(p.qty) || 0) * uw : null;
          if (injectionVars.priceVar && !p.off[injectionVars.priceVar]) {
            pp[injectionVars.priceVar] = pricePerKgOf(mat, consumptionKg);
          }
        }
      }
      return {
        code: p.code || undefined,
        name: p.name,
        materialCode: p.materialCode || undefined,
        qty: Number(p.qty) || 0,
        params: pp,
        manualAmounts: keepManuals(p.manuals, p.off),
      };
    });

    return { cParams, moldsIn, partsIn };
  }, [commonParams, commonOff, molds, parts, matByCode, moldSteelVars, injectionVars]);

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
    return calculateQuoteProject({
      items: defs,
      common: {
        profitRate: cfg.moldType?.profitRate ?? 0.1,
        taxRate: cfg.moldType?.taxRate ?? 0.13,
        qtyVarName,
        params: calcInput.cParams,
      },
      molds: calcInput.moldsIn,
      parts: calcInput.partsIn,
      extras,
    });
  }, [cfg, calcInput, qtyVarName, extras]);

  /**
   * 「费用明细」默认展开。
   * 折叠状态下新增费用项（尤其金额为 0 的）完全看不见，用户会以为没同步；展开后一目了然，
   * 用户手动收起后不会再被强制打开（只在出现新的行时才补展开）。
   */
  useEffect(() => {
    if (!result) return;
    setDetailOpen((s) => {
      let changed = false;
      const next = { ...s };
      (result.moldResults ?? []).forEach((_: any, i: number) => {
        if (next[`m${i}`] === undefined) { next[`m${i}`] = true; changed = true; }
      });
      (result.partResults ?? []).forEach((_: any, i: number) => {
        if (next[`p${i}`] === undefined) { next[`p${i}`] = true; changed = true; }
      });
      return changed ? next : s;
    });
  }, [result]);

  const submit = async () => {
    if (!cfg) return;
    if (!customer.name.trim()) {
      fb.toast('请填写客户名称', 'err');
      return;
    }
    setSaving(true);
    try {
      const created = await quotes.createProject({
        moldTypeId: cfg.moldType.id,
        customerName: customer.name.trim(),
        customerPhone: customer.phone.trim() || undefined,
        productName: customer.productName.trim() || undefined,
        extras,
        common: {
          profitRate: cfg.moldType.profitRate,
          taxRate: cfg.moldType.taxRate,
          qtyVarName,
          // 与实时预览同一套参数（已应用「不纳入→0」「材料库取价」）
          params: calcInput.cParams,
          off: commonOff,
        },
        molds: calcInput.moldsIn.map((m, i) => ({
          ...m,
          off: molds[i].off,
          image: molds[i].image ?? null,
        })),
        parts: calcInput.partsIn.map((p, i) => ({
          ...p,
          off: parts[i].off,
          image: parts[i].image ?? null,
        })),
      });
      navigate(`/quotes/${created.id}`);
    } catch (e: any) {
      fb.toast('生成失败：' + (e.response?.data?.error || e.message), 'err');
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

  /** 算模具重量用的钢材密度（取当前第一套模具的参数，兜底 7.85） */
  const steelDensity = (() => {
    const v = Number(molds[0]?.params?.['钢材密度']);
    return Number.isFinite(v) && v > 0 ? v : 7.85;
  })();
  /** 算单件重量用的塑料密度（取材料库里第一种塑料，兜底 ABS 的 1.05） */
  const plasticDensity = (() => {
    const m = matList.find((x: any) => x.category === '塑料原料' && Number(x.density) > 0);
    return m ? Number(m.density) : 1.05;
  })();

  /**
   * 3D 图纸解析结果落地：解析出的参数 + 渲染缩略图，一起写到对应的件上。
   * 用一次性函数式更新（而不是循环里反复 setMold），
   * 这样多个件指向同一个目标时也不会互相覆盖。
   */
  /**
   * 智能识别结果落地 —— 3D / Excel / Word / 图片统一走这里。
   * 用一次性函数式更新（而不是循环里反复 setMold），
   * 这样多个件指向同一个目标时也不会互相覆盖。
   */
  const applyImportItems = (items: ApplyItem[]) => {
    let created = 0;
    let updated = 0;

    setMolds((arr) => {
      const next = [...arr];
      for (const it of items) {
        if (it.kind !== 'mold') continue;
        if (it.target.mode === 'update') {
          const uid = it.target.uid; // 先取出来，否则闭包里类型收窄会失效
          const idx = next.findIndex((m) => m.uid === uid);
          if (idx < 0) continue;
          next[idx] = {
            ...next[idx],
            name: it.name || next[idx].name,
            params: { ...next[idx].params, ...it.params },
            ...(it.image ? { image: it.image } : {}),
          };
          updated++;
        } else {
          const nm = seedMold(cfg, next.length + 1);
          next.push({
            ...nm,
            name: it.name || nm.name,
            params: { ...nm.params, ...it.params },
            image: it.image ?? null,
          });
          created++;
        }
      }
      return next;
    });

    setParts((arr) => {
      const next = [...arr];
      for (const it of items) {
        if (it.kind !== 'part') continue;
        if (it.target.mode === 'update') {
          const uid = it.target.uid;
          const idx = next.findIndex((p) => p.uid === uid);
          if (idx < 0) continue;
          next[idx] = {
            ...next[idx],
            name: it.name || next[idx].name,
            params: { ...next[idx].params, ...it.params },
            ...(it.image ? { image: it.image } : {}),
          };
          updated++;
        } else {
          const np = seedPart(cfg, next.length + 1);
          next.push({
            ...np,
            name: it.name || np.name,
            params: { ...np.params, ...it.params },
            image: it.image ?? null,
          });
          created++;
        }
      }
      return next;
    });

    fb.toast(`导入完成：新建 ${created} 个，更新 ${updated} 个`);
  };

  /**
   * 三期：Excel 参数表（列映射）导入适配。
   * 纯映射逻辑在 utils/importParams（便于脱机单测），这里只负责落状态 + 提示。
   * 利润/税仍「以配置中心为主」——提交时取 cfg.moldType。
   */
  const applyImportParams = (data: any) => {
    const r = applyImportedParams(data, cfg, qtyVarName, qtyDefault);
    if (r.molds.length) setMolds(r.molds);
    if (r.parts.length) setParts(r.parts);
    setCommonParams(r.commonParams);
    if (data.common?.off) setCommonOff(data.common.off);
    if (r.otherExtras.length) setExtras((e) => ({ ...e, otherExtras: r.otherExtras }));

    // 利润/税率以配置中心为准（提交时取 cfg.moldType），Excel 里填了也不覆盖 —— 明确告知，别让用户以为生效了
    const rateNote =
      data.common?.profitRate !== undefined || data.common?.taxRate !== undefined
        ? '；利润/税率以配置中心为准，未覆盖'
        : '';
    const warn =
      rateNote +
      (data.unmatched?.length ? `；${data.unmatched.length} 列未识别，请人工核对` : '') +
      (data.warnings?.length ? `；${data.warnings.length} 条提示` : '');
    fb.toast(
      `参数表导入完成：模具 ${r.counts.molds} 套 · 注塑件 ${r.counts.parts} 个 · 其他费用 ${r.counts.otherExtras} 项${warn}`,
    );
  };

  const setPart = (i: number, patch: Partial<PartState>) =>
    setParts((arr) => arr.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const copyMold = (i: number) =>
    setMolds((arr) => [
      ...arr,
      { ...arr[i], uid: uid(), name: arr[i].name + ' 副本', off: { ...arr[i].off }, manuals: { ...arr[i].manuals } },
    ]);
  const copyPart = (i: number) =>
    setParts((arr) => [
      ...arr,
      { ...arr[i], uid: uid(), name: arr[i].name + ' 副本', off: { ...arr[i].off }, manuals: { ...arr[i].manuals } },
    ]);

  // ---------- 「纳入 / 不纳入计算」开关 ----------
  const toggleCommonOff = (name: string) => setCommonOff((s) => ({ ...s, [name]: !s[name] }));
  const toggleMoldOff = (i: number, name: string) =>
    setMolds((arr) => arr.map((m, idx) => (idx === i ? { ...m, off: { ...m.off, [name]: !m.off[name] } } : m)));
  const togglePartOff = (i: number, name: string) =>
    setParts((arr) => arr.map((p, idx) => (idx === i ? { ...p, off: { ...p.off, [name]: !p.off[name] } } : p)));


  /**
   * 选/换材料牌号。
   * B 档：材料库的损耗率作为「默认值」带进输入框，之后用户改了就以用户为准，不再被覆盖。
   * （单价与密度仍由材料库决定，见 submit 里的取值顺序 —— 价格模式 B：材料库是唯一价格来源。）
   */
  const pickMoldSteel = (i: number, code: string) => {
    const mat = code ? matByCode.get(code) : null;
    const patch: Partial<MoldState> = { materialCode: code };
    if (mat && moldSteelVars.lossVar && mat.lossRate != null) {
      patch.params = { ...molds[i].params, [moldSteelVars.lossVar]: String(mat.lossRate) };
    }
    setMold(i, patch);
  };
  const pickPartMaterial = (i: number, code: string) => {
    const mat = code ? matByCode.get(code) : null;
    const patch: Partial<PartState> = { materialCode: code };
    if (mat && injectionVars.lossVar && mat.lossRate != null) {
      patch.params = { ...parts[i].params, [injectionVars.lossVar]: String(mat.lossRate) };
    }
    setPart(i, patch);
  };

  const renderParamInput = (p: any, value: any, onChange: (v: any) => void) => {
    const opts: any[] = Array.isArray(p.options) ? p.options : [];

    /**
     * 材料库下拉：选项直接来自「材料中心」的某个分类（默认模具钢材）。
     *
     * 这里存的是**材料编码**而不是价格 —— 材料中心改价时，
     * 选项文字和实际算出的钢材费都会跟着变，不需要改任何配置。
     */
    if (p.type === 'material') {
      const cat =
        p.options && !Array.isArray(p.options) && p.options.category
          ? p.options.category
          : '模具钢材';
      const list = usableMaterials.filter((m: any) => m.category === cat);
      return (
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full border border-emerald-300 bg-emerald-50 text-emerald-900 rounded px-2.5 py-2 text-sm"
        >
          <option value="">按公共钢材单价</option>
          {list.map((m: any) => (
            <option key={m.id} value={m.code}>
              {m.name} · {Math.round(pricePerKgOf(m, null) * 100) / 100} 元/kg
            </option>
          ))}
        </select>
      );
    }

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

  /**
   * 一个「参数栏」= 标签 + 纳入开关 + 输入控件（+ 可选提示）。
   * 开关把这一栏排除出算价：值留着，但不参与计算，导出的报价表也不会出现这一行。
   */
  const renderField = (
    p: any,
    value: any,
    onChange: (v: any) => void,
    off: boolean,
    onToggle: () => void,
    hint?: any,
  ) => (
    <label className="text-sm">
      <span className="text-gray-500 flex items-center justify-between gap-2">
        <span className="truncate">
          {p.name}
          {p.unit && <span className="text-gray-400 text-xs"> ({p.unit})</span>}
        </span>
        <OffToggle off={off} onToggle={onToggle} />
      </span>
      <div className={off ? 'opacity-40 pointer-events-none' : ''}>
        {renderParamInput(p, value, onChange)}
      </div>
      {hint}
    </label>
  );

  /**
   * 材料驱动的参数（钢材单价/密度、原料单价…）：值由材料库决定，用户改了也不会生效。
   * 所以不给输入框，直接只读展示 + 标注来源，避免「填了没反应」。
   */
  const readonlyField = (label: string, display: string, note: string) => (
    <div className="text-sm">
      <span className="text-gray-500">{label}</span>
      <div className="mt-1 border border-gray-200 bg-gray-50 rounded px-2.5 py-2 text-sm text-gray-600 flex items-center justify-between gap-2">
        <span className="tabular-nums truncate">{display}</span>
        <span className="text-[10.5px] text-gray-400 shrink-0">{note}</span>
      </div>
    </div>
  );

  /**
   * 材料驱动的参数在「选了牌号」后由材料库取值。返回：
   *   null      —— 不受材料影响，正常渲染（带纳入开关）
   *   'locked'  —— 相关对象**全都**选了牌号 → 这个值完全用不到 → 只读展示
   *   'partial' —— 只有部分选了 → 对「没选牌号」的仍然生效 → 可编辑 + 提示
   *
   * includeLoss：损耗率是否也算「材料驱动」。
   *   损耗率本身允许用户覆盖（B 档），所以在「注塑件/模具」区块里**不算**；
   *   但如果配置把它放在「公共参数」，选了牌号后每套模具/每个注塑件都会各自覆盖它，
   *   那个公共值就成了摆设 —— 这时要按材料驱动处理，免得又变成一个"填了没反应"的坑。
   */
  const materialDriven = (name: string, includeLoss = false): 'locked' | 'partial' | null => {
    if (!name) return null;
    let isSteel = name === moldSteelVars.priceVar || name === moldSteelVars.densityVar;
    let isMat = name === injectionVars.priceVar;
    if (includeLoss) {
      isSteel = isSteel || name === moldSteelVars.lossVar;
      isMat = isMat || name === injectionVars.lossVar;
    }
    if (!isSteel && !isMat) return null;
    const list: any[] = isSteel ? molds : parts;
    if (!list.length) return null;
    const picked = list.filter((x) => x.materialCode).length;
    if (picked === 0) return null;
    return picked === list.length ? 'locked' : 'partial';
  };

  /** 手填金额类费用项（标准件费 / 后加工费 …）—— 也带「不纳入计算」开关 */
  const renderManualField = (
    label: string,
    value: any,
    onChange: (v: any) => void,
    off: boolean,
    onToggle: () => void,
  ) => (
    <label className="text-sm">
      <span className="text-gray-500 flex items-center justify-between gap-2">
        <span className="truncate">{label}</span>
        <OffToggle off={off} onToggle={onToggle} />
      </span>
      <div className={off ? 'opacity-40 pointer-events-none' : ''}>
        <input
          type="number"
          step="any"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full border border-gray-300 rounded px-2.5 py-2 text-sm text-right tabular-nums"
          placeholder="0"
        />
      </div>
    </label>
  );

  return (
    <div className="max-w-[1600px] mx-auto p-5">
      {fb.host}
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

      {/* 价格从哪来 —— 三级取价顺序，一眼看懂 */}
      <div className="bg-slate-50 border border-gray-200 rounded-lg px-4 py-2.5 mb-4 text-[12px] text-gray-600 leading-5">
        <b className="text-gray-800">价格从哪来（自动按顺序取）：</b>
        ① 选了材料牌号 → 按材料库该牌号现价　
        ② 没选 → 按配置中心同步价　
        ③ 都没有 → 该项按 0 计入并<b className="text-red-700">中文提醒你补价</b>，不会默默出错
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

      {/* 智能识别：3D / Excel / Word / 图片 / 询价表 统一入口，置于客户信息之上 */}
      <div className="mb-3">
        <SmartImport
          molds={molds.map((m) => ({ uid: m.uid, name: m.name }))}
          parts={parts.map((p) => ({ uid: p.uid, name: p.name }))}
          moldDensity={steelDensity}
          partDensity={plasticDensity}
          onApply={applyImportItems}
          onImportParams={applyImportParams}
          onError={(msg) => fb.toast(msg, 'err')}
          onInfo={(msg) => fb.toast(msg)}
        />
      </div>

      <div className="grid gap-3.5 items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) 400px' }}>
        {/* 左：填数据 */}
        <div className="space-y-3.5">
          {/* 客户信息 */}
          <div className="bg-white border border-gray-200 rounded-lg">
            <div
              onClick={() => toggleSec('customer')}
              className={`px-3.5 py-3 flex items-center gap-2 cursor-pointer select-none hover:bg-gray-50 ${
                secOpen.customer ? 'border-b border-gray-200' : ''
              }`}
              title={secOpen.customer ? '点击折叠' : '点击展开'}
            >
              <span className="text-gray-400 text-[10px]">{secOpen.customer ? '▼' : '▶'}</span>
              <span className="font-semibold text-sm">客户信息</span>
              {!secOpen.customer && customer.name && (
                <span className="text-xs text-gray-400 truncate">{customer.name}</span>
              )}
            </div>
            {secOpen.customer && (
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
            )}
          </div>

          {/* 模具列表 */}
          <div className="bg-white border border-gray-200 rounded-lg">
            <div
              className={`px-3.5 py-3 flex items-center justify-between ${
                secOpen.molds ? 'border-b border-gray-200' : ''
              }`}
            >
              <div
                onClick={() => toggleSec('molds')}
                className="flex items-center gap-2 cursor-pointer select-none flex-1 min-w-0 hover:opacity-80"
                title={secOpen.molds ? '点击折叠' : '点击展开'}
              >
                <span className="text-gray-400 text-[10px]">{secOpen.molds ? '▼' : '▶'}</span>
                <span className="font-semibold text-sm">模具（{molds.length} 套）</span>
              </div>
              <button
                onClick={() => setMolds((arr) => [...arr, seedMold(cfg, arr.length + 1)])}
                className="text-xs bg-gray-900 text-white px-2.5 py-1 rounded hover:bg-gray-800"
              >
                + 加一套模具
              </button>
            </div>
            {secOpen.molds && (
            <div className="p-3.5 space-y-3">
              {molds.map((m, i) => (
                <div key={m.uid} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-start gap-2 mb-2">
                    <ImageSlot
                      image={m.image}
                      onChange={(img) => setMold(i, { image: img })}
                      onError={(msg) => fb.toast(msg, 'err')}
                      onInfo={(msg) => fb.toast(msg)}
                      size={48}
                    />
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
                          onChange={(e) => pickMoldSteel(i, e.target.value)}
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
                      {moldDefs.map((p) => {
                        const md = materialDriven(p.name);
                        const shown =
                          m.params[p.name] === '' || m.params[p.name] == null
                            ? '—'
                            : String(m.params[p.name]);
                        return (
                          <div key={p.id ?? p.name} className="min-w-0">
                            {md === 'locked'
                              ? readonlyField(p.name, shown, '材料库带入')
                              : renderField(
                                  p,
                                  m.params[p.name],
                                  (v) => setMold(i, { params: { ...m.params, [p.name]: v } }),
                                  !!m.off[p.name],
                                  () => toggleMoldOff(i, p.name),
                                  md === 'partial' ? (
                                    <span className="block mt-1 text-[10.5px] text-amber-700 leading-tight">
                                      本套已选牌号，按材料库取值
                                    </span>
                                  ) : undefined,
                                )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* 费用项（来自配置中心）—— 加什么就看得见什么 */}
                  {/* 待填费用：配置中心里「手填金额」类型的项。公式类的不在这儿铺开 —— 看右侧「实时算价」 */}
                  {manualItems('mold').length > 0 && (
                    <div className="mt-3 pt-3 border-t border-dashed border-gray-200">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[12px] font-medium text-gray-600">待填费用</span>
                        <span className="text-[11px] text-gray-400">
                          配置中心设为「手填金额」的 {manualItems('mold').length} 项
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-x-4 gap-y-3">
                        {manualItems('mold').map((it: any) => (
                          <div key={it.id ?? it.name} className="min-w-0">
                            {renderManualField(
                              it.name,
                              m.manuals[it.name],
                              (v) => setMold(i, { manuals: { ...m.manuals, [it.name]: v } }),
                              !!m.off[it.name],
                              () => toggleMoldOff(i, it.name),
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              ))}
              {molds.length === 0 && (
                <p className="text-center text-gray-400 text-sm py-4">暂无模具，点右上角「加一套模具」</p>
              )}
            </div>
            )}
          </div>

          {/* 注塑件列表 */}
          <div className="bg-white border border-gray-200 rounded-lg">
            <div
              className={`px-3.5 py-3 flex items-center justify-between ${
                secOpen.parts ? 'border-b border-gray-200' : ''
              }`}
            >
              <div
                onClick={() => toggleSec('parts')}
                className="flex items-center gap-2 cursor-pointer select-none flex-1 min-w-0 hover:opacity-80"
                title={secOpen.parts ? '点击折叠' : '点击展开'}
              >
                <span className="text-gray-400 text-[10px]">{secOpen.parts ? '▼' : '▶'}</span>
                <span className="font-semibold text-sm">注塑件（{parts.length} 个）</span>
              </div>
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
            {secOpen.parts && (
            <div className="p-3.5 space-y-3">
              {parts.map((p, i) => (
                <div key={p.uid} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-start gap-2 mb-2">
                    <ImageSlot
                      image={p.image}
                      onChange={(img) => setPart(i, { image: img })}
                      onError={(msg) => fb.toast(msg, 'err')}
                      onInfo={(msg) => fb.toast(msg)}
                      size={48}
                    />
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
                        onChange={(e) => pickPartMaterial(i, e.target.value)}
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
                      {!p.materialCode && injectionVars.priceVar && (
                        <div className="text-[12px] text-gray-400 mt-1">
                          {injectionVars.priceVar}：未选牌号，按配置中心同步价 ¥
                          {Number(p.params[injectionVars.priceVar] ?? 0).toLocaleString('zh-CN', {
                            maximumFractionDigits: 4,
                          })}
                          /kg（此处只读，要改价格去材料库）
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
                      .map((d) => {
                        const md = materialDriven(d.name);
                        const shown =
                          p.params[d.name] === '' || p.params[d.name] == null
                            ? '—'
                            : String(p.params[d.name]);
                        return (
                          <div key={d.id ?? d.name} className="min-w-0">
                            {md === 'locked'
                              ? readonlyField(d.name, shown, '材料库带入')
                              : renderField(
                                  d,
                                  p.params[d.name],
                                  (v) => setPart(i, { params: { ...p.params, [d.name]: v } }),
                                  !!p.off[d.name],
                                  () => togglePartOff(i, d.name),
                                  md === 'partial' ? (
                                    <span className="block mt-1 text-[10.5px] text-amber-700 leading-tight">
                                      本件已选牌号，按材料库取值
                                    </span>
                                  ) : undefined,
                                )}
                          </div>
                        );
                      })}
                  </div>

                  {/* 费用项（来自配置中心）—— 加什么就看得见什么 */}
                  {/* 待填费用：配置中心里「手填金额」类型的项。公式类的不在这儿铺开 —— 看右侧「实时算价」 */}
                  {manualItems('injection').length > 0 && (
                    <div className="mt-3 pt-3 border-t border-dashed border-gray-200">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[12px] font-medium text-gray-600">待填费用</span>
                        <span className="text-[11px] text-gray-400">
                          配置中心设为「手填金额」的 {manualItems('injection').length} 项
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-x-4 gap-y-3">
                        {manualItems('injection').map((it: any) => (
                          <div key={it.id ?? it.name} className="min-w-0">
                            {renderManualField(
                              it.name,
                              p.manuals[it.name],
                              (v) => setPart(i, { manuals: { ...p.manuals, [it.name]: v } }),
                              !!p.off[it.name],
                              () => togglePartOff(i, it.name),
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              ))}
              {parts.length === 0 && (
                <p className="text-center text-gray-400 text-sm py-4">暂无注塑件，点右上角「加 1 件」</p>
              )}
            </div>
            )}
          </div>

          {/* 其他价格：整单级自由费用（按需求放到页面最底下） */}
          <div className="bg-white border border-gray-200 rounded-lg">
            <div className="px-3.5 py-3 border-b border-gray-200 font-semibold text-sm flex items-center justify-between">
              <span>其他价格</span>
              <span className="text-[12px] font-normal text-gray-500">利润前计入总价</span>
            </div>
            <div className="p-3.5">
              {/* 整单参数（scope=common）—— 配置中心新增/改动的整单参数会自动出现在这里 */}
              {commonDefs.length > 0 && (
                <div className="mb-3 pb-3 border-b border-dashed border-gray-200">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[12px] font-medium text-gray-600">整单参数</span>
                    <span className="text-[11px] text-gray-400">来自配置中心 · 整单统一</span>
                  </div>
                  <div className="grid grid-cols-3 gap-x-4 gap-y-3">
                    {commonDefs.map((p: any) => (
                      <div key={p.id ?? p.name} className="min-w-0">
                        {renderField(
                          p,
                          commonParams[p.name],
                          (v) => setCommonParams((s) => ({ ...s, [p.name]: v })),
                          !!commonOff[p.name],
                          () => toggleCommonOff(p.name),
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <ExtrasEditor
                title=""
                unitHint="整单级，可自由增删"
                items={extras.otherExtras ?? []}
                onAdd={() => addExtra('otherExtras')}
                onRemove={(id) => removeExtra('otherExtras', id)}
                onChange={(id, patch) => patchExtra('otherExtras', id, patch)}
              />
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
                        <div key={li} className="space-y-0.5">
                          <div className="flex justify-between text-[11.5px] text-gray-500 gap-2">
                            <span className="truncate">{l.name}</span>
                            <span className="tabular-nums shrink-0">
                              {l.error ? (
                                <span className="text-red-600">缺参数</span>
                              ) : l.manual ? (
                                '报价时填'
                              ) : Number(l.value) ? (
                                money(l.value)
                              ) : (
                                <span className="text-gray-400">未设值</span>
                              )}
                            </span>
                          </div>
                          {l.warning && (
                            <div className="text-[11px] text-amber-600 leading-snug">⚠ {l.warning}</div>
                          )}
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
                        <div key={li} className="space-y-0.5">
                          <div className="flex justify-between text-[11.5px] text-gray-500 gap-2">
                            <span className="truncate">{l.name}</span>
                            <span className="tabular-nums shrink-0">
                              {l.error ? (
                                <span className="text-red-600">缺参数</span>
                              ) : l.manual ? (
                                '报价时填'
                              ) : Number(l.value) ? (
                                money(l.value)
                              ) : (
                                <span className="text-gray-400">未设值</span>
                              )}
                            </span>
                          </div>
                          {l.warning && (
                            <div className="text-[11px] text-amber-600 leading-snug">⚠ {l.warning}</div>
                          )}
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
            {((result?.moldResults ?? []).some((m: any) =>
              (m.lines ?? []).some((l: any) => l.warning),
            ) || (result?.partResults ?? []).some((p: any) =>
              (p.lines ?? []).some((l: any) => l.warning),
            )) && (
              <div className="text-[12.5px] text-amber-600 mt-1">部分费用项价格/数据为空（已按 0 计入），请补充后重新计算</div>
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
            {result && (result.moldExtrasTotal > 0 || (extras.moldExtras?.length ?? 0) > 0) && (
              <div className="flex justify-between text-[12px] text-gray-400 py-0.5 pl-3">
                <span>└ 模具附加费（{extras.moldExtras?.length ?? 0} 项）</span>
                <span className="tabular-nums">{money(result?.moldExtrasTotal ?? 0)}</span>
              </div>
            )}
            {result && (result.injectionExtrasUnit > 0 || (extras.injectionExtras?.length ?? 0) > 0) && (
              <div className="flex justify-between text-[12px] text-gray-400 py-0.5 pl-3">
                <span>└ 注塑附加费（单件 × 总量）</span>
                <span className="tabular-nums">{money(result?.injectionExtrasUnit ?? 0)}/件</span>
              </div>
            )}
            {result && (result.otherExtrasTotal > 0 || (extras.otherExtras?.length ?? 0) > 0) && (
              <div className="flex justify-between text-[13px] text-gray-600 py-0.5">
                <span>其他价格（整单）</span>
                <span className="tabular-nums">{money(result?.otherExtrasTotal ?? 0)}</span>
              </div>
            )}
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
