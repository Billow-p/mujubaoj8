import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { materials } from '../api';
import { useFeedback } from '../components/feedback';
import { MATERIAL_GROUPS, MATERIAL_SUB_CATEGORIES } from '@mqs/shared';

const EMPTY = {
  code: '',
  name: '',
  category: '塑料原料',
  subCategory: '通用塑料',
  unit: 'kg',
  density: '',
  lossRate: '0.05',
  currentPrice: '0',
  priceRule: 'fixed',
  priceTiers: [] as TierRow[],
  remark: '',
  enabled: true,
};

/** 重量法算价只认这几个单位（其它单位会被折算或忽略） */
const WEIGHT_UNITS = ['kg', 'g', 't'];

interface TierRow {
  minQty: string;
  maxQty: string;
  price: string;
}

/** 服务端存的是 JSON 字符串，编辑时要转成可输入的字符串行 */
const parseTiers = (raw: any): TierRow[] => {
  let arr: any[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) arr = p;
    } catch {
      /* 坏数据当没有 */
    }
  }
  return arr.map((t) => ({
    minQty: t?.minQty == null ? '' : String(t.minQty),
    maxQty: t?.maxQty == null ? '' : String(t.maxQty),
    price: t?.price == null ? '' : String(t.price),
  }));
};

/** 初始化预置材料可按模具类型分类同步 —— 口径与后端 TYPE_MATERIAL_CATEGORIES 一致 */
const SEED_OPTIONS = [
  { code: 'injection', label: '注塑模具', desc: '模具钢材 + 塑料原料 + 辅助材料' },
  { code: 'diecast', label: '压铸模具', desc: '模具钢材 + 压铸合金 + 辅助材料' },
  { code: 'twocolor', label: '双色模具', desc: '模具钢材 + 塑料原料（硬胶/软胶）+ 辅助材料' },
  { code: 'rubber', label: '橡胶模具', desc: '模具钢材 + 橡胶原料 + 辅助材料' },
];

const emptyTier = (): TierRow => ({ minQty: '', maxQty: '', price: '' });

/**
 * 材料中心
 *
 * 分类按行业主流分两级：
 *   一级 = 用途场景（模具钢材 / 塑料原料 / 压铸合金 / 辅助材料）
 *   二级 = 材质体系（热作模具钢 / 工程塑料 / 铝合金 …）
 * 列表按一级分类分组展示；两级分类都用 datalist，既能选预置值也能自己填。
 */
export default function Materials() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [priceHistory, setPriceHistory] = useState<any[] | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [formErr, setFormErr] = useState('');
  const [seedOpen, setSeedOpen] = useState(false);
  const [seedSel, setSeedSel] = useState<Record<string, boolean>>({});
  const [seeding, setSeeding] = useState(false);
  const fb = useFeedback();

  // 库存操作（ERP）：kind = 入库 / 出库 / 盘点
  const [stockOp, setStockOp] = useState<{ m: any; kind: 'in' | 'out' | 'adjust' } | null>(null);
  const [stockQty, setStockQty] = useState('');
  const [stockRemark, setStockRemark] = useState('');
  const [stockBusy, setStockBusy] = useState(false);
  const [ledgerOf, setLedgerOf] = useState<any | null>(null);
  const [ledgerRows, setLedgerRows] = useState<any[]>([]);
  const [lowStock, setLowStock] = useState<any[]>([]);
  // Excel 批量入库
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  // 全公司台账 / 低库存清单
  const [ledgerAllOpen, setLedgerAllOpen] = useState(false);
  const [ledgerAllRows, setLedgerAllRows] = useState<any[]>([]);
  const [lowOpen, setLowOpen] = useState(false);

  /**
   * silent=true 静默刷新：不触发整页 loading。
   * 页面操作（出入库 / 导入 / 保存）之后都用静默刷新 —— 否则列表会被
   * 「加载中…」整块替换掉，滚动位置丢失，页面猛跳一下。
   */
  const load = (silent = false) => {
    if (!silent) setLoading(true);
    Promise.all([materials.list(), materials.lowStock().catch(() => [])])
      .then(([l, low]) => {
        setList(l);
        setLowStock(Array.isArray(low) ? low : []);
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
  };
  useEffect(() => {
    load();
  }, []);

  // 按一级分类分组：预置顺序在前，用户自建的分类排最后
  // 只要有材料，就把 5 个标准分类都列出来 —— 每个分类右上角都有自己的「+ 新增材料」，
  // 用户想往「橡胶原料」这类暂时为空的分类里加材料时也有入口。
  const groups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const m of list) {
      const g = m.category || '未分类';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(m);
    }
    if (list.length > 0) {
      for (const g of MATERIAL_GROUPS) if (!map.has(g)) map.set(g, []);
    }
    const order: string[] = [...MATERIAL_GROUPS, '其他'];
    const idx = (g: string) => {
      const i = order.indexOf(g);
      return i < 0 ? 99 : i;
    };
    return [...map.entries()].sort((a, b) => idx(a[0]) - idx(b[0]) || a[0].localeCompare(b[0]));
  }, [list]);

  const seed = async (codes?: string[]) => {
    setSeeding(true);
    try {
      const r = await materials.seedPreset(codes);
      const extra = r.classified ? `，并为 ${r.classified} 个已有材料补全了分类` : '';
      const scope = codes && codes.length ? '所选类型相关材料' : '全部材料';
      fb.toast(`已补充 ${r.created} 个预置材料（${scope}，共 ${r.total} 个，已存在的不覆盖价格）${extra}`);
      setSeedOpen(false);
      load(true);
    } catch (e: any) {
      fb.toast('初始化失败：' + (e.response?.data?.error || e.message), 'err');
    } finally {
      setSeeding(false);
    }
  };

  const confirmSeed = () => {
    const codes = SEED_OPTIONS.filter((o) => seedSel[o.code]).map((o) => o.code);
    const all = SEED_OPTIONS.every((o) => seedSel[o.code]);
    if (!codes.length) return; // 按钮已禁用，双保险
    seed(all ? undefined : codes);
  };

  // ---- 库存操作（ERP）----
  const openStock = (m: any, kind: 'in' | 'out' | 'adjust') => {
    setStockOp({ m, kind });
    setStockQty('');
    setStockRemark('');
  };

  const showLedger = async (m: any) => {
    setLedgerOf(m);
    setLedgerRows([]);
    try {
      setLedgerRows(await materials.ledger(m.id, 50));
    } catch {
      /* 流水拉不到就显示空态，不打断页面 */
    }
  };

  const submitStock = async () => {
    if (!stockOp) return;
    const qty = Number(stockQty);
    const isAdjust = stockOp.kind === 'adjust';
    // 盘点允许填 0（实际清空了），入库/出库必须大于 0
    if (!Number.isFinite(qty) || qty < 0 || (!isAdjust && qty === 0)) {
      fb.toast('数量要填一个大于 0 的数字', 'err');
      return;
    }
    setStockBusy(true);
    try {
      const { m, kind } = stockOp;
      const lowHint = (r: any) => (r.lowStock ? '，已低于安全库存，记得补货' : '');
      if (kind === 'in') {
        const r = await materials.stockIn(m.id, { qty, remark: stockRemark || undefined });
        fb.toast(`已入库 ${qty}${m.unit}，当前库存 ${r.balanceAfter}${r.unit}${lowHint(r)}`, r.lowStock ? 'warn' : 'ok');
      } else if (kind === 'out') {
        const r = await materials.stockOut(m.id, { qty, remark: stockRemark || undefined });
        fb.toast(`已出库 ${qty}${m.unit}，当前库存 ${r.balanceAfter}${r.unit}${lowHint(r)}`, r.lowStock ? 'warn' : 'ok');
      } else {
        const r = await materials.stockAdjust(m.id, { actualQty: qty, remark: stockRemark || undefined });
        fb.toast(r.unchanged ? '库存无变化' : `盘点完成，库存调整为 ${r.balanceAfter}${r.unit}`, 'ok');
      }
      setStockOp(null);
      load(true);
      if (ledgerOf?.id === m.id) showLedger(m);
    } catch (e: any) {
      fb.toast('操作失败：' + (e.response?.data?.error || e.message), 'err');
    } finally {
      setStockBusy(false);
    }
  };

  /**
   * blob 下载。坑：后端报错时返回的也是 200 + JSON（content-type: application/json），
   * 直接存盘会得到一个打不开的「xlsx」，所以先认出 JSON 并把错误读出来。
   */
  const downloadBlob = async (blob: any, filename: string): Promise<boolean> => {
    if (!blob || (blob.type && String(blob.type).includes('application/json'))) {
      try {
        const t = typeof blob?.text === 'function' ? await blob.text() : '';
        const j = JSON.parse(t || '{}');
        fb.toast(j.error ? '失败：' + j.error : '下载失败', 'err');
      } catch {
        fb.toast('下载失败', 'err');
      }
      return false;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  };

  const openCompanyLedger = async () => {
    setLedgerAllOpen(true);
    setLedgerAllRows([]);
    try {
      setLedgerAllRows(await materials.ledgerAll({ take: 200 }));
    } catch {
      /* 拉不到就显示空态，不打断页面 */
    }
  };

  const downloadTemplate = async () => {
    try {
      const ok = await downloadBlob(await materials.stockTemplateBlob(), '批量入库模板.xlsx');
      if (ok) fb.toast('模板已下载，填好数量再上传', 'ok');
    } catch (e: any) {
      fb.toast('模板下载失败：' + (e?.message ?? '未知错误'), 'err');
    }
  };

  const submitImport = async () => {
    if (!importFile) {
      fb.toast('先选一个 .xlsx 文件', 'err');
      return;
    }
    setImportBusy(true);
    try {
      const r = await materials.stockImport(importFile);
      setImportResult(r);
      if (r.created > 0) {
        fb.toast(
          `已入库 ${r.created} 种材料（表内 ${r.total} 行）${r.errors?.length ? `，${r.errors.length} 行有问题` : ''}`,
          r.errors?.length ? 'warn' : 'ok',
        );
        load(true);
      } else {
        fb.toast('一条都没入库成功，看下面的明细', 'err');
      }
    } catch (e: any) {
      fb.toast('导入失败：' + (e.response?.data?.error || e.message), 'err');
    } finally {
      setImportBusy(false);
    }
  };

  const exportLedger = async () => {
    try {
      // 文件名精确到秒：同一天多次导出不重名，避免在下载目录里开到旧文件
      const d = new Date();
      const p2 = (n: number) => String(n).padStart(2, '0');
      const ts = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
      const ok = await downloadBlob(await materials.ledgerExportBlob({}), `库存台账_${ts}.xlsx`);
      if (ok) fb.toast('台账已导出', 'ok');
    } catch (e: any) {
      fb.toast('导出失败：' + (e?.message ?? '未知错误'), 'err');
    }
  };

  /**
   * 在某个一级分类下新增材料。
   * 分类按钮下放到每个分组的右上角，用户点哪个分类就在哪个分类里新增，
   * 不用先打开表单再自己挑分类（原来的做法容易选错）。
   */
  const addInGroup = (category: string) => {
    setFormErr('');
    setIsNew(true);
    setEditing({
      ...EMPTY,
      category,
      subCategory: MATERIAL_SUB_CATEGORIES[category]?.[0] ?? '',
    });
    // 顺手把该分组展开，保存后新行能立刻看到
    setCollapsed((s) => ({ ...s, [category]: false }));
  };

  /** 保存前先在本地校验，不让用户被服务端的英文报错劝退 */
  const validate = (): string => {
    const name = String(editing.name ?? '').trim();
    const code = String(editing.code ?? '').trim();
    if (!name) return '请填写材料名称';
    if (code && !/^[A-Za-z0-9._-]+$/.test(code))
      return '材料编码只能用字母、数字、下划线、短横线、点（也可以留空自动生成）';
    if (code.length > 30) return '材料编码最多 30 个字符';
    if (name.length > 50) return '材料名称最多 50 个字符';
    const price = Number(editing.currentPrice);
    if (!Number.isFinite(price) || price < 0) return '单价要填一个不小于 0 的数字';
    const loss = Number(editing.lossRate);
    if (!Number.isFinite(loss) || loss < 0 || loss > 1) return '损耗率要填 0~1 之间的数字（如 0.05）';
    if (editing.density !== '' && editing.density != null) {
      const d = Number(editing.density);
      if (!Number.isFinite(d) || d < 0) return '密度要填一个不小于 0 的数字';
    }
    if (editing.priceRule === 'tiered') {
      const rows = parseTiers(editing.priceTiers);
      if (rows.length === 0) return '阶梯价至少要填一档';
      for (const [i, t] of rows.entries()) {
        const min = Number(t.minQty);
        const price = Number(t.price);
        if (!t.minQty || !Number.isFinite(min) || min < 0) return `第 ${i + 1} 档的「用量下限」要填不小于 0 的数字`;
        if (!t.price || !Number.isFinite(price) || price < 0) return `第 ${i + 1} 档的「单价」要填不小于 0 的数字`;
        if (t.maxQty) {
          const max = Number(t.maxQty);
          if (!Number.isFinite(max) || max < min) return `第 ${i + 1} 档的「用量上限」要不小于下限`;
        }
      }
    }
    return '';
  };

  const save = async () => {
    const bad = validate();
    if (bad) {
      setFormErr(bad);
      return;
    }
    setFormErr('');
    const tiered = editing.priceRule === 'tiered';
    const body: any = {
      ...editing,
      code: String(editing.code ?? '').trim(),
      name: String(editing.name ?? '').trim(),
      density: editing.density === '' || editing.density == null ? undefined : Number(editing.density),
      lossRate: Number(editing.lossRate),
      currentPrice: Number(editing.currentPrice),
      subCategory: editing.subCategory || null,
      remark: editing.remark ?? '',
      priceRule: tiered ? 'tiered' : 'fixed',
      priceTiers: tiered
        ? parseTiers(editing.priceTiers).map((t) => ({
            minQty: Number(t.minQty),
            maxQty: t.maxQty ? Number(t.maxQty) : null,
            price: Number(t.price),
          }))
        : [],
    };
    try {
      if (isNew) {
        const created = await materials.create(body);
        setList((prev) => [...prev, created]);
        // 新增后自动展开对应分类，让用户立刻看到新行
        setCollapsed((s) => ({ ...s, [created.category || '未分类']: false }));
      } else {
        const updated = await materials.update(editing.id, body);
        setList((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)));
      }
      setEditing(null);
    } catch (e: any) {
      setFormErr(e.response?.data?.error || e.message || '保存失败');
    }
  };

  // ---- 阶梯价行的增删改（始终基于当前编辑对象） ----
  const setTier = (i: number, k: keyof TierRow, v: string) =>
    setEditing((e: any) => {
      const rows = parseTiers(e?.priceTiers);
      rows[i] = { ...rows[i], [k]: v };
      return { ...e, priceTiers: rows };
    });
  const addTier = () =>
    setEditing((e: any) => ({ ...e, priceTiers: [...parseTiers(e?.priceTiers), emptyTier()] }));
  const removeTier = (i: number) =>
    setEditing((e: any) => {
      const rows = parseTiers(e?.priceTiers);
      rows.splice(i, 1);
      return { ...e, priceTiers: rows };
    });

  /** 直接列表里启用 / 停用（原来只有状态标签，没法切换） */
  const toggleEnabled = async (m: any) => {
    const next = !m.enabled;
    // 乐观更新：先改本地状态，避免整页 loading 导致跳动
    setList((prev) => prev.map((x) => (x.id === m.id ? { ...x, enabled: next } : x)));
    try {
      await materials.update(m.id, { enabled: next });
    } catch (e: any) {
      // 失败回滚
      setList((prev) => prev.map((x) => (x.id === m.id ? { ...x, enabled: m.enabled } : x)));
      fb.toast('操作失败：' + (e.response?.data?.error || e.message), 'err');
    }
  };

  const remove = (m: any) => {
    fb.confirmBox(
      { title: '删除材料', message: `确定删除材料「${m.name}」？此操作不可恢复。`, okText: '删除', danger: true },
      async () => {
        try {
          await materials.remove(m.id);
          // 本地移除，避免整页刷新导致跳动
          setList((prev) => prev.filter((x) => x.id !== m.id));
          fb.toast('已删除');
        } catch (e: any) {
          fb.toast(e.response?.data?.error || e.message, 'err');
        }
      },
    );
  };

  const showPrices = async (id: string) => {
    setPriceHistory(await materials.prices(id));
  };

  const toggle = (g: string) => setCollapsed((c) => ({ ...c, [g]: !c[g] }));

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-5">
      {fb.host}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">材料中心</h1>
            <span className="text-[11px] bg-blue-50 border border-blue-200 text-blue-700 rounded px-2 py-0.5">
              第 1 步 · 共 4 步
            </span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* 第 1 步：补齐预置材料 */}
          <button
            onClick={() => { setSeedSel({}); setSeedOpen(true); }}
            title={
              list.length === 0
                ? '第一次使用：把 39 种行业常用材料一键灌入材料库（可按模具类型勾选）'
                : '已初始化过：重复点击只补缺失的材料，不会改你已设的价格'
            }
            className={
              list.length === 0
                ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white px-4 py-2 rounded text-sm font-medium shadow-md shadow-blue-500/25 hover:opacity-90 whitespace-nowrap'
                : 'border border-gray-300 px-4 py-2 rounded text-sm hover:bg-gray-50 whitespace-nowrap'
            }
          >
            {list.length === 0 ? '第 1 步：初始化预置材料' : '第 1 步：补齐预置材料'}
          </button>
          <button
            onClick={() => { setImportResult(null); setImportFile(null); setImportOpen(true); }}
            className="border border-gray-300 px-4 py-2 rounded text-sm hover:bg-gray-50 whitespace-nowrap"
            title="上传 Excel 批量登记入库：先下载模板，按材料编码填数量"
          >
            批量入库
          </button>
          <button
            onClick={() => openCompanyLedger()}
            className="border border-gray-300 px-4 py-2 rounded text-sm hover:bg-gray-50 whitespace-nowrap"
            title="查看全公司出入库流水，可导出 Excel"
          >
            库存台账
          </button>
          {/* 第 2 步：去配置中心同步 */}
          <Link
            to="/settings/config"
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm whitespace-nowrap"
          >
            第 2 步：去配置中心同步 →
          </Link>
        </div>
      </div>

      {/* 低库存预警（只提示，不拦任何操作） */}
      {!loading && lowStock.length > 0 && (
        <div className="flex items-center justify-between gap-3 border border-amber-200 bg-amber-50 rounded px-4 py-2.5">
          <span className="text-[12.5px] text-amber-800">
            {lowStock.length} 种材料低于安全库存，建议尽快补货
          </span>
          <button
            onClick={() => setLowOpen(true)}
            className="text-[12.5px] text-amber-900 underline hover:no-underline whitespace-nowrap"
          >
            看清单
          </button>
        </div>
      )}

      {/* 分类概览 */}
      {!loading && list.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-gray-500 mr-1">共 {list.length} 种</span>
          {groups.map(([g, items]) => (
            <button
              key={g}
              onClick={() => toggle(g)}
              className={`text-[12.5px] border rounded-full px-3 py-1 transition ${
                collapsed[g]
                  ? 'border-gray-200 text-gray-400 hover:border-gray-300'
                  : 'border-gray-900 bg-gray-900 text-white'
              }`}
            >
              {g} <span className="tabular-nums opacity-70">{items.length}</span>
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="bg-white border border-gray-200 rounded py-10 text-center text-sm text-gray-400">加载中…</div>
      )}

      {!loading && list.length === 0 && (
        <div className="bg-white border border-gray-200 rounded py-10 text-center text-sm text-gray-400">
          暂无材料，点击右上角「初始化预置材料」
        </div>
      )}

      {/* 分组表格 */}
      {!loading &&
        groups.map(([g, items]) => {
          const subs = [...new Set(items.map((i) => i.subCategory).filter(Boolean))] as string[];
          return (
            <div key={g} className="bg-white border border-gray-200 rounded overflow-hidden">
              <div className="w-full px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center gap-2.5">
                <div
                  onClick={() => toggle(g)}
                  className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer select-none hover:opacity-80"
                  title={collapsed[g] ? '点击展开这一类' : '点击收起这一类'}
                >
                  <span className="text-gray-400 text-[11px] w-3">{collapsed[g] ? '▶' : '▼'}</span>
                  <span className="font-medium text-sm text-gray-900">{g}</span>
                  <span className="text-[12px] text-gray-400 tabular-nums">{items.length} 种</span>
                  <span className="text-[11.5px] text-gray-400 truncate hidden sm:block">
                    {subs.join(' · ')}
                  </span>
                </div>
                <button
                  onClick={() => addInGroup(g)}
                  title={`在「${g}」下新增一个材料`}
                  className="text-[12px] border border-gray-300 bg-white px-2.5 py-1 rounded hover:bg-gray-100 hover:border-gray-400 whitespace-nowrap shrink-0"
                >
                  + 新增材料
                </button>
              </div>

              {!collapsed[g] && (
                <table className="w-full text-sm">
                  <thead className="text-gray-500 text-[12px]">
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-4 py-2 font-normal">编码 / 名称</th>
                      <th className="text-left px-3 py-2 font-normal">细分</th>
                      <th className="text-left px-3 py-2 font-normal">单位</th>
                      <th className="text-right px-3 py-2 font-normal">单价</th>
                      <th className="text-right px-3 py-2 font-normal">损耗率</th>
                      <th className="text-right px-3 py-2 font-normal">库存</th>
                      <th className="text-left px-3 py-2 font-normal">状态</th>
                      <th className="text-right px-4 py-2 font-normal">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-6 text-center text-[12.5px] text-gray-400">
                          这一类还没有材料，点右上角「+ 新增材料」按「{g}」添加
                        </td>
                      </tr>
                    )}
                    {items.map((m) => (
                      <tr key={m.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2">
                          <div className="text-gray-900">{m.name}</div>
                          <div className="text-[11.5px] text-gray-400 font-mono">{m.code}</div>
                        </td>
                        <td className="px-3 py-2">
                          {m.subCategory ? (
                            <span className="text-[11.5px] border border-gray-200 text-gray-600 rounded px-1.5 py-0.5">
                              {m.subCategory}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{m.unit}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          ¥{Number(m.currentPrice).toFixed(2)}
                          {m.priceRule === 'tiered' && (
                            <span className="ml-1.5 text-[10.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5">
                              阶梯价
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                          {Math.round(m.lossRate * 100)}%
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {m.stockEnabled ? (
                            <>
                              <span
                                className={m.stockQty < m.safetyStock ? 'text-amber-700' : 'text-gray-900'}
                                title={m.stockQty < m.safetyStock ? '低于安全库存，建议补货' : ''}
                              >
                                {Number(m.stockQty).toFixed(2)}
                              </span>
                              {m.safetyStock > 0 && (
                                <span className="ml-1 text-[10.5px] text-gray-400">
                                  / 安全 {Number(m.safetyStock).toFixed(0)}
                                </span>
                              )}
                              {m.stockQty < m.safetyStock && (
                                <div className="text-[10.5px] text-amber-700">库存偏低</div>
                              )}
                            </>
                          ) : (
                            <span className="text-gray-300 text-[11.5px]">未管库存</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => toggleEnabled(m)}
                            title={m.enabled ? '点击停用（报价页不再可选）' : '点击启用'}
                            className={`text-[11.5px] px-2 py-0.5 rounded border transition ${
                              m.enabled
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200'
                                : 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'
                            }`}
                          >
                            {m.enabled ? '启用' : '停用'}
                          </button>
                          {m.isPreset && <span className="ml-1 text-[11.5px] text-gray-400">预置</span>}
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          <button
                            onClick={() => openStock(m, 'in')}
                            title="登记入库（采购到货），库存增加"
                            className="text-gray-600 hover:text-gray-900 text-xs px-1.5"
                          >
                            入库
                          </button>
                          <button
                            onClick={() => openStock(m, 'out')}
                            title="登记出库（车间领料），库存减少"
                            className="text-gray-600 hover:text-gray-900 text-xs px-1.5"
                          >
                            出库
                          </button>
                          <button
                            onClick={() => showLedger(m)}
                            title="查看出入库流水"
                            className="text-gray-600 hover:text-gray-900 text-xs px-1.5"
                          >
                            流水
                          </button>
                          <button onClick={() => showPrices(m.id)} className="text-gray-600 hover:text-gray-900 text-xs px-2">
                            价格历史
                          </button>
                          <button
                            onClick={() => {
                              setIsNew(false);
                              setFormErr('');
                              setEditing({ ...m, priceRule: m.priceRule || 'fixed', priceTiers: parseTiers(m.priceTiers) });
                            }}
                            className="text-gray-600 hover:text-gray-900 text-xs px-2"
                          >
                            编辑
                          </button>
                          {m.isPreset ? (
                            <span className="text-gray-300 text-xs px-2" title="预置材料不能删除，可点状态列停用">
                              删除
                            </span>
                          ) : (
                            <button onClick={() => remove(m)} className="text-red-600 hover:text-red-800 text-xs px-2">
                              删除
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}

      {/* 入库 / 出库 / 盘点 */}
      {stockOp && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6 z-50">
          <div className="bg-white rounded-lg w-full max-w-sm shadow-xl">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="font-medium">
                {stockOp.kind === 'in' ? '入库' : stockOp.kind === 'out' ? '出库' : '库存盘点'} — {stockOp.m.name}
              </h2>
              <p className="text-[12.5px] text-gray-500 mt-1">
                {stockOp.kind === 'in'
                  ? '登记采购到货，库存增加'
                  : stockOp.kind === 'out'
                  ? '登记车间领料，库存减少'
                  : '按实际盘点数调整库存，差额自动生成盘盈/盘亏记录'}
              </p>
            </div>
            <div className="px-6 py-4 space-y-3">
              <label className="block text-sm">
                <span className="text-gray-600">
                  {stockOp.kind === 'adjust' ? '实际库存数量' : '数量'}（{stockOp.m.unit}）
                </span>
                <input
                  type="number"
                  step="0.01"
                  value={stockQty}
                  onChange={(e) => setStockQty(e.target.value)}
                  placeholder="0.00"
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="text-gray-600">备注</span>
                <input
                  value={stockRemark}
                  onChange={(e) => setStockRemark(e.target.value)}
                  placeholder="选填，如供应商 / 用途 / 批次"
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                />
              </label>
              <p className="text-[11.5px] text-gray-400">
                当前库存 {Number(stockOp.m.stockQty).toFixed(2)} {stockOp.m.unit}
                {Number(stockOp.m.safetyStock) > 0 && `，安全库存 ${Number(stockOp.m.safetyStock).toFixed(0)}`}
              </p>
            </div>
            <div className="px-6 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setStockOp(null)} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50">
                取消
              </button>
              <button
                onClick={submitStock}
                disabled={stockBusy}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50"
              >
                {stockBusy ? '处理中…' : '确定'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 库存流水 */}
      {ledgerOf && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6 z-50">
          <div className="bg-white rounded-lg w-full max-w-2xl shadow-xl max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <div>
                <h2 className="font-medium">库存流水 — {ledgerOf.name}</h2>
                <p className="text-[12.5px] text-gray-500 mt-1">
                  当前库存 {Number(ledgerOf.stockQty).toFixed(2)} {ledgerOf.unit}
                </p>
              </div>
              <button onClick={() => setLedgerOf(null)} className="text-gray-400 hover:text-gray-700 text-sm">
                关闭
              </button>
            </div>
            <div className="overflow-auto px-6 py-4 flex-1">
              {ledgerRows.length === 0 ? (
                <p className="text-[12.5px] text-gray-400 text-center py-8">还没有出入库记录</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-gray-500 text-[12px]">
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 font-normal">时间</th>
                      <th className="text-left py-2 font-normal">类型</th>
                      <th className="text-right py-2 font-normal">数量</th>
                      <th className="text-right py-2 font-normal">变动后</th>
                      <th className="text-left py-2 font-normal">来源</th>
                      <th className="text-left py-2 font-normal">备注</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {ledgerRows.map((r: any) => (
                      <tr key={r.id}>
                        <td className="py-2 text-[11.5px] text-gray-500 whitespace-nowrap">
                          {new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false })}
                        </td>
                        <td className="py-2">
                          <span
                            className={`text-[11.5px] px-1.5 py-0.5 rounded border ${
                              r.direction === 'in'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : r.direction === 'out'
                                ? 'bg-red-50 text-red-700 border-red-200'
                                : 'bg-gray-50 text-gray-600 border-gray-200'
                            }`}
                          >
                            {r.direction === 'in' ? '入库' : r.direction === 'out' ? '出库' : '盘点'}
                          </span>
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {r.direction === 'out' ? '-' : r.direction === 'in' ? '+' : ''}
                          {Number(r.qty).toFixed(2)}
                        </td>
                        <td className="py-2 text-right tabular-nums text-gray-600">
                          {Number(r.balanceAfter).toFixed(2)}
                        </td>
                        <td className="py-2 text-[11.5px] text-gray-500">{r.refId ?? '手动'}</td>
                        <td className="py-2 text-[11.5px] text-gray-500">{r.remark ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Excel 批量入库 */}
      {importOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6 z-50">
          <div className="bg-white rounded-lg w-full max-w-lg shadow-xl max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="font-medium">Excel 批量入库</h2>
              <p className="text-[12.5px] text-gray-500 mt-1">
                先下载模板，按「材料编码 + 数量」填好再上传；同一个编码填多行会自动累加成一条记录。
              </p>
            </div>
            <div className="px-6 py-4 space-y-3 flex-1 overflow-auto">
              <button onClick={downloadTemplate} className="text-[12.5px] text-blue-700 underline hover:no-underline">
                下载模板（含材料编码对照）
              </button>
              <div>
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={(e) => {
                    setImportFile(e.target.files?.[0] ?? null);
                    setImportResult(null);
                  }}
                  className="block w-full text-[12.5px] text-gray-600 file:mr-3 file:px-3 file:py-1.5 file:border file:border-gray-300 file:rounded file:text-[12.5px] file:bg-white hover:file:bg-gray-50"
                />
                {importFile && <p className="text-[11.5px] text-gray-400 mt-1">已选：{importFile.name}</p>}
              </div>
              {importResult && (
                <div className="border border-gray-200 rounded p-3 text-[12.5px]">
                  <div className="text-gray-700">
                    成功 {importResult.created} 种 / 表内 {importResult.total} 行
                    {importResult.batchNo && <span className="text-gray-400 ml-2">批次 {importResult.batchNo}</span>}
                  </div>
                  {importResult.items?.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {importResult.items.map((it: any) => (
                        <li key={it.code} className="text-gray-600">
                          {it.code} {it.name} +{it.qty}
                          {it.unit} → 库存 {it.balanceAfter}
                          {it.unit}
                          {it.lowStock && <span className="text-amber-700 ml-1">（仍偏低）</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {importResult.errors?.length > 0 && (
                    <div className="mt-2 text-red-700">
                      有 {importResult.errors.length} 行没处理：
                      <ul className="mt-1 space-y-0.5">
                        {importResult.errors.map((e: any, i: number) => (
                          <li key={i}>
                            第 {e.row} 行「{e.code || '空'}」— {e.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="px-6 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setImportOpen(false)} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50">
                关闭
              </button>
              <button
                onClick={submitImport}
                disabled={importBusy}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50"
              >
                {importBusy ? '导入中…' : '开始导入'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 全公司库存台账 */}
      {ledgerAllOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6 z-50">
          <div className="bg-white rounded-lg w-full max-w-3xl shadow-xl max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="font-medium">库存台账</h2>
              <div className="flex items-center gap-3">
                <button onClick={exportLedger} className="text-[12.5px] text-blue-700 underline hover:no-underline">
                  导出 Excel
                </button>
                <button onClick={() => setLedgerAllOpen(false)} className="text-gray-400 hover:text-gray-700 text-sm">
                  关闭
                </button>
              </div>
            </div>
            <div className="overflow-auto px-6 py-4 flex-1">
              {ledgerAllRows.length === 0 ? (
                <p className="text-[12.5px] text-gray-400 text-center py-8">还没有出入库记录</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-gray-500 text-[12px]">
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 font-normal">时间</th>
                      <th className="text-left py-2 font-normal">材料</th>
                      <th className="text-left py-2 font-normal">类型</th>
                      <th className="text-right py-2 font-normal">数量</th>
                      <th className="text-right py-2 font-normal">变动后</th>
                      <th className="text-left py-2 font-normal">来源</th>
                      <th className="text-left py-2 font-normal">备注</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {ledgerAllRows.map((r: any) => (
                      <tr key={r.id}>
                        <td className="py-2 text-[11.5px] text-gray-500 whitespace-nowrap">
                          {new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false })}
                        </td>
                        <td className="py-2 text-[11.5px]">
                          {r.material?.name ?? '—'}
                          <span className="text-gray-400 ml-1 font-mono">{r.material?.code ?? ''}</span>
                        </td>
                        <td className="py-2">
                          <span
                            className={`text-[11.5px] px-1.5 py-0.5 rounded border ${
                              r.direction === 'in'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : r.direction === 'out'
                                ? 'bg-red-50 text-red-700 border-red-200'
                                : 'bg-gray-50 text-gray-600 border-gray-200'
                            }`}
                          >
                            {r.direction === 'in' ? '入库' : r.direction === 'out' ? '出库' : '盘点'}
                          </span>
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {r.direction === 'out' ? '-' : r.direction === 'in' ? '+' : ''}
                          {Number(r.qty).toFixed(2)}
                        </td>
                        <td className="py-2 text-right tabular-nums text-gray-600">
                          {Number(r.balanceAfter).toFixed(2)}
                        </td>
                        <td className="py-2 text-[11.5px] text-gray-500">{r.refId ?? '手动'}</td>
                        <td className="py-2 text-[11.5px] text-gray-500">{r.remark ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 低库存清单 */}
      {lowOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6 z-50">
          <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="font-medium">低库存材料（{lowStock.length}）</h2>
              <p className="text-[12.5px] text-gray-500 mt-1">低于安全库存的材料，建议补货；系统不会拦报价。</p>
            </div>
            <div className="px-6 py-4 space-y-2 max-h-[50vh] overflow-auto">
              {lowStock.map((m: any) => (
                <div key={m.id} className="flex justify-between items-center text-[12.5px]">
                  <span className="text-gray-800">{m.name}</span>
                  <span className="text-amber-700 tabular-nums">
                    {Number(m.stockQty).toFixed(2)} / 安全 {Number(m.safetyStock ?? 0).toFixed(0)} {m.unit}
                  </span>
                </div>
              ))}
            </div>
            <div className="px-6 py-3 border-t border-gray-200 flex justify-end">
              <button onClick={() => setLowOpen(false)} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50">
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 初始化预置材料：按模具类型分类同步 */}
      {seedOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6 z-50">
          <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="font-medium">初始化预置材料</h2>
              <p className="text-[12.5px] text-gray-500 mt-1">
                选择要同步哪类模具的材料；已存在的材料不会覆盖你改过的价格。
                <br />
                这个按钮只负责把<strong>材料</strong>灌进库；日常改价直接在表格里改「单价」，改完去配置中心点「同步」生效。
              </p>
            </div>
            <div className="p-6 space-y-2">
              <label className="flex items-center gap-2.5 border border-gray-200 rounded px-3 py-2.5 cursor-pointer hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={SEED_OPTIONS.every((o) => seedSel[o.code])}
                  onChange={(e) =>
                    setSeedSel(Object.fromEntries(SEED_OPTIONS.map((o) => [o.code, e.target.checked])))
                  }
                  className="w-4 h-4"
                />
                <span className="text-sm font-medium">全部同步</span>
                <span className="text-[11.5px] text-gray-400">四类模具的材料都灌入</span>
              </label>
              {SEED_OPTIONS.map((o) => (
                <label key={o.code} className="flex items-center gap-2.5 border border-gray-200 rounded px-3 py-2.5 cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={!!seedSel[o.code]}
                    onChange={(e) => setSeedSel((s) => ({ ...s, [o.code]: e.target.checked }))}
                    className="w-4 h-4"
                  />
                  <span className="text-sm w-[70px] shrink-0">{o.label}</span>
                  <span className="text-[11.5px] text-gray-400">{o.desc}</span>
                </label>
              ))}
            </div>
            <div className="px-6 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setSeedOpen(false)} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50">
                取消
              </button>
              <button
                onClick={confirmSeed}
                disabled={seeding || !SEED_OPTIONS.some((o) => seedSel[o.code])}
                className={`px-4 py-2 text-sm rounded ${
                  seeding || !SEED_OPTIONS.some((o) => seedSel[o.code])
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-gray-900 text-white hover:bg-gray-800'
                }`}
              >
                {seeding ? '同步中…' : '开始同步'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 价格历史 */}
      {priceHistory && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6 z-50">
          <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="font-medium">价格版本历史</h2>
              <button onClick={() => setPriceHistory(null)} className="text-gray-400 hover:text-gray-600">关闭</button>
            </div>
            <div className="p-6 space-y-1 text-sm max-h-80 overflow-y-auto">
              {priceHistory.map((p) => (
                <div key={p.id} className="flex justify-between border-b border-gray-50 py-1.5">
                  <span className="text-gray-600">V{p.version} · {new Date(p.effectiveFrom).toLocaleDateString('zh-CN')}</span>
                  <span className="font-medium">¥{Number(p.price).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 新增 / 编辑 */}
      {editing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6 z-50">
          <div className="bg-white rounded-lg w-full max-w-lg shadow-xl">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="font-medium">
                {isNew ? `新增材料 · ${editing.category || '未分类'}` : `编辑：${editing.name}`}
              </h2>
            </div>
            {formErr && (
              <div className="mx-6 mt-3 text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
                {formErr}
              </div>
            )}
            <div className="px-6 py-4 grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="text-gray-600">编码（留空自动生成）</span>
                <input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono" placeholder="留空按名称生成，如 ABS" />
              </label>
              <label className="text-sm">
                <span className="text-gray-600">名称 *</span>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" placeholder="如：ABS 或 冷作钢" />
              </label>

              {/* 分类：datalist 可选预置值也可自己填 */}
              <label className="text-sm">
                <span className="text-gray-600">一级分类（用途）</span>
                <input
                  list="mat-groups"
                  value={editing.category ?? ''}
                  onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  placeholder="模具钢材 / 塑料原料 …"
                />
                <datalist id="mat-groups">
                  {MATERIAL_GROUPS.map((g) => <option key={g} value={g} />)}
                </datalist>
              </label>
              <label className="text-sm">
                <span className="text-gray-600">二级分类（材质）</span>
                <input
                  list="mat-subs"
                  value={editing.subCategory ?? ''}
                  onChange={(e) => setEditing({ ...editing, subCategory: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  placeholder="热作模具钢 / 工程塑料 …"
                />
                <datalist id="mat-subs">
                  {(MATERIAL_SUB_CATEGORIES[editing.category] ?? []).map((s) => <option key={s} value={s} />)}
                </datalist>
              </label>

              <label className="text-sm">
                <span className="text-gray-600">单位</span>
                <input
                  list="mat-units"
                  value={editing.unit}
                  onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                />
                <datalist id="mat-units">
                  {['kg', 'g', 't', '个', '件', '米'].map((u) => <option key={u} value={u} />)}
                </datalist>
                {!WEIGHT_UNITS.includes(String(editing.unit || '')) && (
                  <span className="text-[11px] text-amber-700">
                    非重量单位（如「个」）不会参与按重量计价的项目
                  </span>
                )}
              </label>
              <label className="text-sm">
                <span className="text-gray-600">价格规则</span>
                <select
                  value={editing.priceRule ?? 'fixed'}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEditing((cur: any) => ({
                      ...cur,
                      priceRule: v,
                      priceTiers:
                        v === 'tiered' && parseTiers(cur?.priceTiers).length === 0
                          ? [emptyTier()]
                          : parseTiers(cur?.priceTiers),
                    }));
                  }}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                >
                  <option value="fixed">固定单价</option>
                  <option value="tiered">阶梯价（按用量）</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="text-gray-600">
                  {editing.priceRule === 'tiered'
                    ? '基础单价（没命中任何档位时用）'
                    : `单价（元/${editing.unit}）`}
                </span>
                <input type="number" value={editing.currentPrice}
                  onChange={(e) => setEditing({ ...editing, currentPrice: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </label>

              {/* 阶梯价：按「本次材料用量」取价 */}
              {editing.priceRule === 'tiered' && (
                <div className="col-span-2 border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[12.5px] text-gray-700">
                      按本次<strong>材料用量</strong>取价（单位 kg）
                    </span>
                    <button
                      type="button"
                      onClick={addTier}
                      className="text-[12px] bg-gray-900 text-white px-2.5 py-1 rounded hover:bg-gray-800"
                    >
                      + 加一档
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {parseTiers(editing.priceTiers).map((t, ti) => (
                      <div key={ti} className="flex items-center gap-1.5">
                        <input
                          value={t.minQty}
                          onChange={(e) => setTier(ti, 'minQty', e.target.value)}
                          placeholder="用量下限"
                          className="w-[92px] border border-gray-300 rounded px-2 py-1 text-[12.5px] text-right"
                        />
                        <span className="text-[11px] text-gray-400">~</span>
                        <input
                          value={t.maxQty}
                          onChange={(e) => setTier(ti, 'maxQty', e.target.value)}
                          placeholder="不限"
                          className="w-[92px] border border-gray-300 rounded px-2 py-1 text-[12.5px] text-right"
                        />
                        <span className="text-[11px] text-gray-400">kg →</span>
                        <input
                          value={t.price}
                          onChange={(e) => setTier(ti, 'price', e.target.value)}
                          placeholder="单价"
                          className="w-[92px] border border-gray-300 rounded px-2 py-1 text-[12.5px] text-right"
                        />
                        <span className="text-[11px] text-gray-400">元/{editing.unit || 'kg'}</span>
                        <button
                          type="button"
                          onClick={() => removeTier(ti)}
                          className="text-gray-300 hover:text-red-500 text-sm leading-none px-1"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {parseTiers(editing.priceTiers).length === 0 && (
                      <div className="text-[12px] text-gray-400">还没有档位，点「+ 加一档」</div>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                    用量口径：注塑件 = 数量 × 单件重量；模具钢材 = 模芯体积换算重量。单位都是 kg。
                  </p>
                </div>
              )}
              <label className="text-sm">
                <span className="text-gray-600">损耗率（0-1）</span>
                <input type="number" step="0.01" value={editing.lossRate}
                  onChange={(e) => setEditing({ ...editing, lossRate: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </label>
              <label className="text-sm">
                <span className="text-gray-600">密度（g/cm³）</span>
                <input type="number" step="0.01" value={editing.density ?? ''}
                  onChange={(e) => setEditing({ ...editing, density: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </label>
              <label className="text-sm">
                <span className="text-gray-600">状态</span>
                <button
                  type="button"
                  onClick={() => setEditing({ ...editing, enabled: editing.enabled === false })}
                  className={`mt-1 w-full border rounded px-2 py-1.5 text-sm text-left ${
                    editing.enabled === false
                      ? 'border-gray-300 bg-gray-50 text-gray-600'
                      : 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  }`}
                >
                  {editing.enabled === false ? '停用（报价页不可选）' : '启用'}
                </button>
              </label>
              <label className="text-sm">
                <span className="text-gray-600">备注</span>
                <input value={editing.remark ?? ''} onChange={(e) => setEditing({ ...editing, remark: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </label>
            </div>
            <div className="px-6 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50">取消</button>
              <button onClick={save} className="px-4 py-2 text-sm bg-gray-900 text-white rounded hover:bg-gray-800">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
