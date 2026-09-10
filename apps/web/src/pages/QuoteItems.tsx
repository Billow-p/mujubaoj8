import { useEffect, useState } from 'react';
import { quoteItems } from '../api';

const SCOPE_LABEL: Record<string, string> = {
  mold: '模具费用项',
  injection: '注塑单件项',
  summary: '汇总调整项',
};

const CATEGORIES = [
  '材料费', '模架', 'CNC', 'EDM', '线切割', '热流道',
  '滑块', '镶件', '试模', '表面处理', '包装', '运输',
  '人工', '管理费', '利润', '税费', '自定义',
];

const EMPTY = {
  code: '',
  name: '',
  scope: 'mold',
  category: '自定义',
  unit: '元',
  expression: '',
  condition: '',
  sortOrder: 0,
  note: '',
};

export default function QuoteItems() {
  const [list, setList] = useState<any[]>([]);
  const [vars, setVars] = useState<any>({ builtin: [], customParameters: [], quoteItems: [] });
  const [editing, setEditing] = useState<any | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testVars, setTestVars] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([quoteItems.list(), quoteItems.variables()])
      .then(([l, v]) => {
        setList(l);
        setVars(v);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const allVars = [
    ...(vars.builtin ?? []),
    ...(vars.customParameters ?? []),
    ...(vars.quoteItems ?? []),
  ];

  const flash = (t: string) => {
    setMsg(t);
    setTimeout(() => setMsg(null), 2500);
  };

  const openNew = () => {
    setIsNew(true);
    setEditing({ ...EMPTY });
    setTestResult(null);
    setTestVars({});
  };

  const openEdit = (it: any) => {
    setIsNew(false);
    setEditing({ ...it, condition: it.condition ?? '' });
    setTestResult(null);
    setTestVars({});
  };

  const runTest = async (id?: string) => {
    const payload = {
      expression: editing.expression,
      condition: editing.condition || undefined,
      variables: testVars,
    };
    try {
      const r = id
        ? await quoteItems.testOne(id, payload)
        : await quoteItems.test(payload);
      setTestResult(r);
    } catch (e: any) {
      setTestResult({
        ok: false,
        error: e.response?.data?.error || e.message,
      });
    }
  };

  const save = async () => {
    try {
      if (isNew) {
        const created = await quoteItems.create(editing);
        setEditing(created);
        setIsNew(false);
        flash('已创建，请先测试再启用');
      } else {
        await quoteItems.update(editing.id, editing);
        flash('已保存（公式变更需重新测试）');
      }
      load();
    } catch (e: any) {
      alert('保存失败：' + (e.response?.data?.error || e.message));
    }
  };

  const enable = async (id: string) => {
    try {
      await quoteItems.enable(id);
      flash('已启用');
      load();
    } catch (e: any) {
      alert(e.response?.data?.error || e.message);
    }
  };

  const disable = async (id: string) => {
    await quoteItems.disable(id);
    load();
  };

  const duplicate = async (id: string) => {
    await quoteItems.duplicate(id);
    flash('已复制为新版本');
    load();
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`确定删除报价项「${name}」？此操作不可恢复。`)) return;
    await quoteItems.remove(id);
    load();
  };

  const statusBadge = (it: any) => {
    if (it.enabled) {
      return <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">已启用</span>;
    }
    if (it.tested) {
      return <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded">已测试·未启用</span>;
    }
    return <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">未测试</span>;
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">报价项中心</h1>
          <p className="text-sm text-gray-500 mt-1">
            自定义报价项与计算公式，支持条件判断与计算链；测试通过后才能启用
          </p>
        </div>
        <button
          onClick={openNew}
          className="bg-gray-900 text-white px-4 py-2 rounded text-sm font-medium hover:bg-gray-800"
        >
          新建报价项
        </button>
      </div>

      {msg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-4 py-2 rounded">
          {msg}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs">
            <tr>
              <th className="text-left px-4 py-2 font-medium">名称 / 编码</th>
              <th className="text-left px-4 py-2 font-medium">分类</th>
              <th className="text-left px-4 py-2 font-medium">计入</th>
              <th className="text-left px-4 py-2 font-medium">公式</th>
              <th className="text-left px-4 py-2 font-medium">状态</th>
              <th className="text-right px-4 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">加载中…</td></tr>
            )}
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  还没有报价项，点击「新建报价项」开始配置
                </td>
              </tr>
            )}
            {list.map((it) => (
              <tr key={it.id} className="hover:bg-gray-50">
                <td className="px-4 py-2">
                  <div className="font-medium">{it.name}</div>
                  <div className="text-xs text-gray-400">
                    {it.code ? `{${it.code}}` : '—'} · v{it.version}
                  </div>
                </td>
                <td className="px-4 py-2 text-gray-600">{it.category}</td>
                <td className="px-4 py-2 text-gray-600">{SCOPE_LABEL[it.scope] ?? it.scope}</td>
                <td className="px-4 py-2">
                  <code className="text-xs bg-gray-50 px-1.5 py-0.5 rounded font-mono text-gray-700">
                    {it.expression}
                  </code>
                  {it.condition && (
                    <div className="text-xs text-gray-500 mt-1">条件：{it.condition}</div>
                  )}
                </td>
                <td className="px-4 py-2">{statusBadge(it)}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <button onClick={() => openEdit(it)} className="text-gray-600 hover:text-gray-900 text-xs px-2">编辑</button>
                  {it.enabled ? (
                    <button onClick={() => disable(it.id)} className="text-amber-600 hover:text-amber-800 text-xs px-2">停用</button>
                  ) : (
                    <button onClick={() => enable(it.id)} className="text-emerald-600 hover:text-emerald-800 text-xs px-2">启用</button>
                  )}
                  <button onClick={() => duplicate(it.id)} className="text-gray-600 hover:text-gray-900 text-xs px-2">复制</button>
                  <button onClick={() => remove(it.id, it.name)} className="text-red-600 hover:text-red-800 text-xs px-2">删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center overflow-y-auto p-6 z-50">
          <div className="bg-white rounded-lg w-full max-w-3xl shadow-xl">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-medium">{isNew ? '新建报价项' : `编辑：${editing.name}`}</h2>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600">关闭</button>
            </div>

            <div className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <label className="text-sm">
                  <span className="text-gray-600">名称</span>
                  <input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    placeholder="如：热流道费"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-gray-600">编码（可选，供其它公式引用）</span>
                  <input
                    value={editing.code ?? ''}
                    onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                    className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono"
                    placeholder="heatRunnerFee"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-gray-600">分类</span>
                  <select
                    value={editing.category ?? '自定义'}
                    onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                    className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  >
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <label className="text-sm">
                  <span className="text-gray-600">计入</span>
                  <select
                    value={editing.scope}
                    onChange={(e) => setEditing({ ...editing, scope: e.target.value })}
                    className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  >
                    <option value="mold">模具费用项（一次性）</option>
                    <option value="injection">注塑单件项（元/件）</option>
                    <option value="summary">汇总调整项</option>
                  </select>
                </label>
                <label className="text-sm">
                  <span className="text-gray-600">单位</span>
                  <input
                    value={editing.unit ?? ''}
                    onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
                    className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                    placeholder="元 / 元每件"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-gray-600">排序</span>
                  <input
                    type="number"
                    value={editing.sortOrder ?? 0}
                    onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) })}
                    className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
                  />
                </label>
              </div>

              <label className="block text-sm">
                <span className="text-gray-600">公式</span>
                <textarea
                  value={editing.expression}
                  onChange={(e) => setEditing({ ...editing, expression: e.target.value })}
                  rows={2}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono"
                  placeholder="cavityCount * 800 + 5000"
                />
              </label>

              <label className="block text-sm">
                <span className="text-gray-600">条件（可选，满足时才计入该报价项）</span>
                <textarea
                  value={editing.condition ?? ''}
                  onChange={(e) => setEditing({ ...editing, condition: e.target.value })}
                  rows={1}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono"
                  placeholder="cavityCount >= 4 && firstOrderQty > 100000"
                />
              </label>

              <div className="border border-gray-200 rounded">
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-600 flex items-center justify-between">
                  <span>公式测试（可覆盖变量值）</span>
                  <button
                    onClick={() => runTest(isNew ? undefined : editing.id)}
                    className="bg-gray-900 text-white px-3 py-1 rounded text-xs hover:bg-gray-800"
                  >
                    运行测试
                  </button>
                </div>
                <div className="p-3 grid grid-cols-4 gap-2 max-h-40 overflow-y-auto">
                  {allVars.map((v: any) => (
                    <label key={v.key} className="text-xs">
                      <span className="text-gray-500">{v.label}</span>
                      <input
                        type="number"
                        value={testVars[v.key] ?? ''}
                        placeholder={String(v.sample)}
                        onChange={(e) =>
                          setTestVars({
                            ...testVars,
                            [v.key]: e.target.value === '' ? undefined : Number(e.target.value),
                          } as any)
                        }
                        className="mt-0.5 w-full border border-gray-200 rounded px-1.5 py-1 text-xs"
                      />
                    </label>
                  ))}
                </div>
                {testResult && (
                  <div className={`px-3 py-2 text-xs border-t ${testResult.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                    {testResult.ok ? (
                      <>
                        <div>计算过程：{testResult.substituted}</div>
                        {testResult.conditionSubstituted && (
                          <div>条件：{testResult.conditionSubstituted} = {testResult.conditionValue ? '满足' : '不满足'}</div>
                        )}
                        <div className="font-medium mt-1">结果：{testResult.value}</div>
                      </>
                    ) : (
                      <div>测试失败：{testResult.error}</div>
                    )}
                  </div>
                )}
              </div>

              {editing.lastTestResult && (
                <div className="text-xs text-gray-500">
                  上次测试：{editing.lastTestResult}
                  {editing.lastTestAt && ` （${new Date(editing.lastTestAt).toLocaleString('zh-CN')}）`}
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={() => setEditing(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={save}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded hover:bg-gray-800"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
