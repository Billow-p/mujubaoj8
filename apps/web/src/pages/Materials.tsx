import { useEffect, useState } from 'react';
import { materials } from '../api';

const EMPTY = {
  code: '',
  name: '',
  category: '塑料原料',
  unit: 'kg',
  density: '',
  lossRate: '0.05',
  currentPrice: '0',
  priceRule: 'fixed',
  remark: '',
};

export default function Materials() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [priceHistory, setPriceHistory] = useState<any[] | null>(null);

  const load = () => {
    setLoading(true);
    materials.list().then(setList).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const seed = async () => {
    const r = await materials.seedPreset();
    alert(`已补充 ${r.created} 个预置材料（共 ${r.total} 个，已存在的不覆盖）`);
    load();
  };

  const save = async () => {
    const body: any = {
      ...editing,
      density: editing.density === '' ? undefined : Number(editing.density),
      lossRate: Number(editing.lossRate),
      currentPrice: Number(editing.currentPrice),
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

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">材料中心</h1>
          <p className="text-sm text-gray-500 mt-1">
            预置常见塑料与模具钢材，可新增自定义材料；改价自动生成新价格版本
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

      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs">
            <tr>
              <th className="text-left px-4 py-2 font-medium">编码 / 名称</th>
              <th className="text-left px-4 py-2 font-medium">分类</th>
              <th className="text-left px-4 py-2 font-medium">单位</th>
              <th className="text-right px-4 py-2 font-medium">单价</th>
              <th className="text-right px-4 py-2 font-medium">损耗率</th>
              <th className="text-left px-4 py-2 font-medium">状态</th>
              <th className="text-right px-4 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">加载中…</td></tr>}
            {!loading && list.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">暂无材料，点击「初始化预置材料」</td></tr>
            )}
            {list.map((m) => (
              <tr key={m.id} className="hover:bg-gray-50">
                <td className="px-4 py-2">
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-gray-400 font-mono">{m.code}</div>
                </td>
                <td className="px-4 py-2 text-gray-600">{m.category}</td>
                <td className="px-4 py-2 text-gray-600">{m.unit}</td>
                <td className="px-4 py-2 text-right">¥{Number(m.currentPrice).toFixed(2)}</td>
                <td className="px-4 py-2 text-right">{Math.round(m.lossRate * 100)}%</td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${m.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>
                    {m.enabled ? '启用' : '停用'}
                  </span>
                  {m.isPreset && <span className="ml-1 text-xs text-gray-400">预置</span>}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button onClick={() => showPrices(m.id)} className="text-gray-600 hover:text-gray-900 text-xs px-2">价格历史</button>
                  <button onClick={() => { setIsNew(false); setEditing({ ...m }); }} className="text-gray-600 hover:text-gray-900 text-xs px-2">编辑</button>
                  <button onClick={() => remove(m)} className="text-red-600 hover:text-red-800 text-xs px-2">删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
              <label className="text-sm">
                <span className="text-gray-600">分类</span>
                <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                  <option>塑料原料</option><option>模具钢材</option><option>辅料</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="text-gray-600">单位</span>
                <select value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                  <option>kg</option><option>g</option><option>t</option><option>件</option>
                </select>
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
