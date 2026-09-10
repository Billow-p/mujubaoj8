import { useEffect, useState } from 'react';
import { parameters } from '../api';

const TYPES = [
  { v: 'text', l: '文本' },
  { v: 'int', l: '整数' },
  { v: 'decimal', l: '小数' },
  { v: 'money', l: '金额' },
  { v: 'percent', l: '百分比' },
  { v: 'select', l: '单选' },
  { v: 'multiselect', l: '多选' },
  { v: 'switch', l: '开关' },
  { v: 'date', l: '日期' },
];

const GROUPS = ['通用', '模具参数', '注塑参数', '商务参数'];

const EMPTY = {
  code: '',
  name: '',
  type: 'decimal',
  unit: '',
  defaultValue: '',
  required: false,
  options: '',
  group: '通用',
  remark: '',
};

export default function Parameters() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [isNew, setIsNew] = useState(false);

  const load = () => {
    setLoading(true);
    parameters.list().then(setList).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const save = async () => {
    const body: any = { ...editing };
    if (body.options && typeof body.options === 'string') {
      body.options = body.options.split(',').map((s: string) => s.trim()).filter(Boolean);
    }
    try {
      if (isNew) await parameters.create(body);
      else await parameters.update(editing.id, body);
      setEditing(null);
      load();
    } catch (e: any) {
      alert('保存失败：' + (e.response?.data?.error || e.message));
    }
  };

  const toggle = async (id: string) => {
    await parameters.toggle(id);
    load();
  };

  const remove = async (p: any) => {
    if (!confirm(`确定删除参数「${p.name}」？历史报价中已填写的值不受影响。`)) return;
    await parameters.remove(p.id);
    load();
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">参数中心</h1>
          <p className="text-sm text-gray-500 mt-1">
            自定义报价参数，参数编码可直接被报价项公式引用，例如 <code className="bg-gray-100 px-1 rounded">{'{myParam}'}</code>
          </p>
        </div>
        <button
          onClick={() => { setIsNew(true); setEditing({ ...EMPTY }); }}
          className="bg-gray-900 text-white px-4 py-2 rounded text-sm font-medium hover:bg-gray-800"
        >
          新增参数
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs">
            <tr>
              <th className="text-left px-4 py-2 font-medium">名称 / 编码</th>
              <th className="text-left px-4 py-2 font-medium">分组</th>
              <th className="text-left px-4 py-2 font-medium">类型</th>
              <th className="text-left px-4 py-2 font-medium">默认值</th>
              <th className="text-left px-4 py-2 font-medium">必填</th>
              <th className="text-left px-4 py-2 font-medium">状态</th>
              <th className="text-right px-4 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">加载中…</td></tr>}
            {!loading && list.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">暂无自定义参数</td></tr>
            )}
            {list.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-4 py-2">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-gray-400 font-mono">{p.code}</div>
                </td>
                <td className="px-4 py-2 text-gray-600">{p.group}</td>
                <td className="px-4 py-2 text-gray-600">{TYPES.find((t) => t.v === p.type)?.l ?? p.type}</td>
                <td className="px-4 py-2 text-gray-600">{p.defaultValue || '—'}{p.unit ? ` ${p.unit}` : ''}</td>
                <td className="px-4 py-2 text-gray-600">{p.required ? '是' : '否'}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${p.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>
                    {p.enabled ? '启用' : '停用'}
                  </span>
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button onClick={() => { setIsNew(false); setEditing({ ...p, options: p.options ? JSON.parse(p.options).join(',') : '' }); }}
                    className="text-gray-600 hover:text-gray-900 text-xs px-2">编辑</button>
                  <button onClick={() => toggle(p.id)} className="text-amber-600 hover:text-amber-800 text-xs px-2">
                    {p.enabled ? '停用' : '启用'}
                  </button>
                  <button onClick={() => remove(p)} className="text-red-600 hover:text-red-800 text-xs px-2">删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6 z-50">
          <div className="bg-white rounded-lg w-full max-w-lg shadow-xl">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="font-medium">{isNew ? '新增参数' : `编辑：${editing.name}`}</h2>
            </div>
            <div className="px-6 py-4 grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="text-gray-600">名称</span>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </label>
              <label className="text-sm">
                <span className="text-gray-600">编码（公式引用用）</span>
                <input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono" placeholder="hotRunnerPoints" />
              </label>
              <label className="text-sm">
                <span className="text-gray-600">类型</span>
                <select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                  {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="text-gray-600">分组</span>
                <select value={editing.group} onChange={(e) => setEditing({ ...editing, group: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                  {GROUPS.map((g) => <option key={g}>{g}</option>)}
                </select>
              </label>
              <label className="text-sm">
                <span className="text-gray-600">单位</span>
                <input value={editing.unit ?? ''} onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" placeholder="mm / 元 / %" />
              </label>
              <label className="text-sm">
                <span className="text-gray-600">默认值</span>
                <input value={editing.defaultValue ?? ''} onChange={(e) => setEditing({ ...editing, defaultValue: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </label>
              <label className="text-sm col-span-2">
                <span className="text-gray-600">选项（单选/多选时逗号分隔）</span>
                <input value={editing.options ?? ''} onChange={(e) => setEditing({ ...editing, options: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" placeholder="国产, 进口, 合资" />
              </label>
              <label className="text-sm flex items-center gap-2 col-span-2">
                <input type="checkbox" checked={!!editing.required}
                  onChange={(e) => setEditing({ ...editing, required: e.target.checked })} />
                <span className="text-gray-600 text-sm">必填</span>
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
