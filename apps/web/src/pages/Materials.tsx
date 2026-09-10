import { useEffect, useMemo, useState } from 'react';
import { materials } from '../api';
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
  remark: '',
};

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

  const load = () => {
    setLoading(true);
    materials.list().then(setList).finally(() => setLoading(false));
  };
  useEffect(load, []);

  // 按一级分类分组：预置顺序在前，用户自建的分类排最后
  const groups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const m of list) {
      const g = m.category || '未分类';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(m);
    }
    const order: string[] = [...MATERIAL_GROUPS, '其他'];
    const idx = (g: string) => {
      const i = order.indexOf(g);
      return i < 0 ? 99 : i;
    };
    return [...map.entries()].sort((a, b) => idx(a[0]) - idx(b[0]) || a[0].localeCompare(b[0]));
  }, [list]);

  const seed = async () => {
    const r = await materials.seedPreset();
    const extra = r.classified ? `，并为 ${r.classified} 个已有材料补全了分类` : '';
    alert(`已补充 ${r.created} 个预置材料${extra}（共 ${r.total} 个，已存在的不覆盖价格）`);
    load();
  };

  const save = async () => {
    const body: any = {
      ...editing,
      density: editing.density === '' ? undefined : Number(editing.density),
      lossRate: Number(editing.lossRate),
      currentPrice: Number(editing.currentPrice),
      subCategory: editing.subCategory || null,
    };
    try {
      if (isNew) await materials.create(body);
      else await materials.update(editing.id, body);
      setEditing(null);
      load();
    } catch (e: any) {
      alert('保存失败：' + (e.response?.data?.error || e.message));
    }
  };

  const remove = async (m: any) => {
    if (!confirm(`确定删除材料「${m.name}」？`)) return;
    try {
      await materials.remove(m.id);
      load();
    } catch (e: any) {
      alert(e.response?.data?.error || e.message);
    }
  };

  const showPrices = async (id: string) => {
    setPriceHistory(await materials.prices(id));
  };

  const toggle = (g: string) => setCollapsed((c) => ({ ...c, [g]: !c[g] }));

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">材料中心</h1>
          <p className="text-sm text-gray-500 mt-1">
            全局材料库（所有模具类型共用）· 按用途分四类（模具钢材 / 塑料原料 / 压铸合金 / 辅助材料），每类再按材质细分 · 改价自动生成新价格版本
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={seed} className="border border-gray-300 px-4 py-2 rounded text-sm hover:bg-gray-50">
            初始化预置材料
          </button>
          <button
            onClick={() => { setIsNew(true); setEditing({ ...EMPTY }); }}
            className="bg-gray-900 text-white px-4 py-2 rounded text-sm font-medium hover:bg-gray-800"
          >
            新增材料
          </button>
        </div>
      </div>

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
              <button
                onClick={() => toggle(g)}
                className="w-full px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center gap-2.5 hover:bg-gray-100"
              >
                <span className="text-gray-400 text-[11px] w-3">{collapsed[g] ? '▶' : '▼'}</span>
                <span className="font-medium text-sm text-gray-900">{g}</span>
                <span className="text-[12px] text-gray-400 tabular-nums">{items.length} 种</span>
                <span className="ml-auto text-[11.5px] text-gray-400 truncate hidden sm:block">
                  {subs.join(' · ')}
                </span>
              </button>

              {!collapsed[g] && (
                <table className="w-full text-sm">
                  <thead className="text-gray-500 text-[12px]">
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-4 py-2 font-normal">编码 / 名称</th>
                      <th className="text-left px-3 py-2 font-normal">细分</th>
                      <th className="text-left px-3 py-2 font-normal">单位</th>
                      <th className="text-right px-3 py-2 font-normal">单价</th>
                      <th className="text-right px-3 py-2 font-normal">损耗率</th>
                      <th className="text-left px-3 py-2 font-normal">状态</th>
                      <th className="text-right px-4 py-2 font-normal">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
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
                        <td className="px-3 py-2 text-right tabular-nums">¥{Number(m.currentPrice).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                          {Math.round(m.lossRate * 100)}%
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`text-[11.5px] px-2 py-0.5 rounded ${
                              m.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {m.enabled ? '启用' : '停用'}
                          </span>
                          {m.isPreset && <span className="ml-1 text-[11.5px] text-gray-400">预置</span>}
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          <button onClick={() => showPrices(m.id)} className="text-gray-600 hover:text-gray-900 text-xs px-2">
                            价格历史
                          </button>
                          <button
                            onClick={() => { setIsNew(false); setEditing({ ...m }); }}
                            className="text-gray-600 hover:text-gray-900 text-xs px-2"
                          >
                            编辑
                          </button>
                          <button onClick={() => remove(m)} className="text-red-600 hover:text-red-800 text-xs px-2">
                            删除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}

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
              <h2 className="font-medium">{isNew ? '新增材料' : `编辑：${editing.name}`}</h2>
            </div>
            <div className="px-6 py-4 grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="text-gray-600">编码</span>
                <input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono" placeholder="ABS" />
              </label>
              <label className="text-sm">
                <span className="text-gray-600">名称</span>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
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
              </label>
              <label className="text-sm">
                <span className="text-gray-600">单价（元/{editing.unit}）</span>
                <input type="number" value={editing.currentPrice}
                  onChange={(e) => setEditing({ ...editing, currentPrice: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </label>
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
              <label className="text-sm col-span-2">
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
