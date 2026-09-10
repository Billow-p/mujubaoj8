import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { quotes } from '../api';

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  sent: '已发送',
  confirmed: '已成交',
  lost: '未成交',
  void: '已作废',
  expired: '已过期',
};

const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  lost: 'bg-orange-100 text-orange-800',
  void: 'bg-red-100 text-red-800',
  expired: 'bg-gray-200 text-gray-500',
};

const MOLD_LABEL: Record<string, string> = {
  coreSteel: '模芯钢材费',
  designFee: '设计费',
  moldBase: '模架费',
  standardParts: '标准件费',
  cncMachining: 'CNC 加工费',
  edm: 'EDM 放电费',
  wireCutting: '线切割费',
  polishing: '抛光费',
  trialMold: '试模费',
  surfaceTreatment: '表面处理费',
  packagingShipping: '包装运输费',
};

const INJ_LABEL: Record<string, string> = {
  material: '材料费',
  machining: '加工费',
  postProcess: '后加工费',
  packaging: '包装费',
  moldAmortization: '模具分摊',
};

const money = (n: number) => '¥' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });

export default function QuoteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [q, setQ] = useState<any>(null);
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'calc' | 'versions' | 'logs'>('calc');
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustForm, setAdjustForm] = useState({ field: 'grandTotalIncVat', adjustedValue: '', reason: '' });

  const load = () => {
    if (!id) return;
    setLoading(true);
    Promise.all([quotes.get(id), quotes.adjustments(id)])
      .then(([data, adj]) => {
        setQ(data);
        setAdjustments(adj);
      })
      .finally(() => setLoading(false));
  };
  useEffect(load, [id]);

  if (loading) return <div className="max-w-7xl mx-auto p-6 text-gray-400">加载中…</div>;
  if (!q) return <div className="max-w-7xl mx-auto p-6 text-gray-400">报价单不存在</div>;

  const v = q.versions?.[0];
  const input = (v?.paramsJson ?? {}) as any;
  const calc = (v?.calcResultJson ?? {}) as any;
  const summary = calc.summary ?? {};
  const moldItems = calc.moldFeeItems ?? {};
  const injItems = calc.injectionItems ?? {};
  const custom = calc.customFormulas ?? { mold: [], injection: [], summary: [] };

  const doExport = async () => {
    try {
      await quotes.exportExcel(q.id);
    } catch (e: any) {
      alert('导出失败：' + (e.response?.data?.error || e.message));
    }
  };

  const doSend = async () => {
    const email = prompt('发送到客户邮箱：', q.customer?.email || '');
    if (!email) return;
    try {
      await quotes.send(q.id, email);
      alert('已发送');
      load();
    } catch (e: any) {
      alert('发送失败：' + (e.response?.data?.error || e.message));
    }
  };

  const doDuplicate = async () => {
    if (!confirm('复制此报价生成新的草稿报价单？原报价不变。')) return;
    const nq = await quotes.duplicate(q.id);
    navigate(`/quotes/${nq.id}`);
  };

  const setStatus = async (status: string) => {
    const label = STATUS_LABEL[status];
    if (!confirm(`确定将状态改为「${label}」？`)) return;
    await quotes.setStatus(q.id, status);
    load();
  };

  const submitAdjust = async () => {
    if (!adjustForm.adjustedValue) return alert('请填写调整后的值');
    await quotes.adjust(q.id, {
      field: adjustForm.field,
      adjustedValue: Number(adjustForm.adjustedValue),
      systemValue: Number(summary[adjustForm.field] ?? 0),
      reason: adjustForm.reason,
    });
    setAdjustOpen(false);
    setAdjustForm({ field: 'grandTotalIncVat', adjustedValue: '', reason: '' });
    load();
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold font-mono">{q.quoteNo}</h1>
            <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLOR[q.status] ?? 'bg-gray-100'}`}>
              {STATUS_LABEL[q.status] ?? q.status}
            </span>
            <span className="text-xs text-gray-400">v{v?.versionNo ?? 1}</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {q.customer?.name || '—'} · {input.productName || '—'} · 创建于{' '}
            {new Date(q.createdAt).toLocaleString('zh-CN')}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={doExport} className="border border-gray-300 px-3 py-2 rounded text-sm hover:bg-gray-50">
            导出 Excel
          </button>
          <button onClick={doSend} className="border border-gray-300 px-3 py-2 rounded text-sm hover:bg-gray-50">
            发送邮件
          </button>
          <button onClick={doDuplicate} className="border border-gray-300 px-3 py-2 rounded text-sm hover:bg-gray-50">
            复制为新报价
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded p-4">
          <div className="text-xs text-gray-500">模具合计（含税）</div>
          <div className="text-lg font-semibold mt-1">{money(summary.moldIncVat)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded p-4">
          <div className="text-xs text-gray-500">注塑合计（含税）</div>
          <div className="text-lg font-semibold mt-1">{money(summary.injectionIncVat)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded p-4">
          <div className="text-xs text-gray-500">单件成本（不含税）</div>
          <div className="text-lg font-semibold mt-1">{money(summary.unitCostExVat)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded p-4 bg-gray-50">
          <div className="text-xs text-gray-500">含税总价</div>
          <div className="text-lg font-semibold mt-1">{money(summary.grandTotalIncVat)}</div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded p-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-600 mr-2">状态流转：</span>
        {['draft', 'sent', 'confirmed', 'lost', 'void'].map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            disabled={q.status === s}
            className={`text-xs px-3 py-1.5 rounded border ${
              q.status === s
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-300 hover:bg-gray-50'
            }`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
        <button onClick={() => setAdjustOpen(true)} className="text-xs px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 ml-auto">
          人工调整（留痕）
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded">
        <div className="border-b border-gray-200 px-4 flex gap-4 text-sm">
          {([['calc', '计算明细'], ['versions', '版本历史'], ['logs', '操作日志']] as const).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-2 py-3 border-b-2 ${tab === k ? 'border-gray-900 font-medium' : 'border-transparent text-gray-500'}`}
            >
              {l}
            </button>
          ))}
        </div>

        <div className="p-4">
          {tab === 'calc' && (
            <div className="space-y-6">
              <section>
                <h3 className="text-sm font-medium mb-2">客户与产品</h3>
                <div className="grid grid-cols-4 gap-x-6 gap-y-2 text-sm">
                  <Field label="客户名称" value={q.customer?.name} />
                  <Field label="联系人" value={q.customer?.contactName} />
                  <Field label="电话" value={q.customer?.phone} />
                  <Field label="邮箱" value={q.customer?.email} />
                  <Field label="产品名称" value={input.productName} />
                  <Field label="材料" value={input.material} />
                  <Field label="钢材" value={input.steel} />
                  <Field label="复杂度" value={input.complexity} />
                  <Field label="单件重量" value={input.singleWeightKg != null ? `${input.singleWeightKg} kg` : ''} />
                  <Field label="腔数" value={input.cavityCount} />
                  <Field label="成型周期" value={input.cycleTimeS != null ? `${input.cycleTimeS} s` : ''} />
                  <Field label="首单数量" value={Number(input.firstOrderQty || 0).toLocaleString()} />
                </div>
                {input.customParams && Object.keys(input.customParams).length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <div className="text-xs text-gray-500 mb-1">自定义参数</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(input.customParams).map(([k, val]) => (
                        <span key={k} className="text-xs bg-gray-50 border border-gray-200 px-2 py-1 rounded">
                          {k}：{String(val)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              <section>
                <h3 className="text-sm font-medium mb-2">模具费用明细</h3>
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500">
                    <tr>
                      <th className="text-left py-1.5">项目</th>
                      <th className="text-left py-1.5">计算过程</th>
                      <th className="text-right py-1.5">金额</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {Object.entries(moldItems).map(([k, item]: any) => (
                      <tr key={k}>
                        <td className="py-1.5">{MOLD_LABEL[k] ?? k}</td>
                        <td className="py-1.5 text-xs text-gray-500 font-mono">{item.formula}</td>
                        <td className="py-1.5 text-right">{money(item.value)}</td>
                      </tr>
                    ))}
                    {custom.mold?.map((c: any, i: number) => (
                      <tr key={`cm${i}`} className="bg-purple-50/40">
                        <td className="py-1.5">{c.name}<span className="ml-1 text-xs text-purple-600">自定义</span></td>
                        <td className="py-1.5 text-xs text-gray-500 font-mono">{c.expression}</td>
                        <td className="py-1.5 text-right">{money(c.value)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-gray-200">
                      <td className="py-1.5 font-medium">小计</td>
                      <td />
                      <td className="py-1.5 text-right font-medium">{money(summary.moldSubtotal)}</td>
                    </tr>
                    <tr>
                      <td className="py-1.5">管理费与利润</td>
                      <td className="py-1.5 text-xs text-gray-500">按 {Math.round((input.managementRate ?? 0.15) * 100)}%</td>
                      <td className="py-1.5 text-right">{money(summary.moldManagementFee)}</td>
                    </tr>
                    {summary.moldExtrasTotal > 0 && (
                      <tr>
                        <td className="py-1.5">附加项</td>
                        <td />
                        <td className="py-1.5 text-right">{money(summary.moldExtrasTotal)}</td>
                      </tr>
                    )}
                    <tr className="border-t border-gray-200">
                      <td className="py-1.5 font-medium">模具合计（含税）</td>
                      <td />
                      <td className="py-1.5 text-right font-medium">{money(summary.moldIncVat)}</td>
                    </tr>
                  </tbody>
                </table>
              </section>

              <section>
                <h3 className="text-sm font-medium mb-2">注塑单件成本</h3>
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500">
                    <tr>
                      <th className="text-left py-1.5">项目</th>
                      <th className="text-left py-1.5">计算过程</th>
                      <th className="text-right py-1.5">元/件</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {Object.entries(injItems).map(([k, item]: any) => (
                      <tr key={k}>
                        <td className="py-1.5">{INJ_LABEL[k] ?? k}</td>
                        <td className="py-1.5 text-xs text-gray-500 font-mono">{item.formula}</td>
                        <td className="py-1.5 text-right">{money(item.value)}</td>
                      </tr>
                    ))}
                    {custom.injection?.map((c: any, i: number) => (
                      <tr key={`ci${i}`} className="bg-purple-50/40">
                        <td className="py-1.5">{c.name}<span className="ml-1 text-xs text-purple-600">自定义</span></td>
                        <td className="py-1.5 text-xs text-gray-500 font-mono">{c.expression}</td>
                        <td className="py-1.5 text-right">{money(c.value)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-gray-200">
                      <td className="py-1.5 font-medium">单件合计</td>
                      <td />
                      <td className="py-1.5 text-right font-medium">{money(summary.unitCostExVat)}</td>
                    </tr>
                    <tr>
                      <td className="py-1.5">注塑合计（{Number(input.firstOrderQty || 0).toLocaleString()} 件，含税）</td>
                      <td />
                      <td className="py-1.5 text-right font-medium">{money(summary.injectionIncVat)}</td>
                    </tr>
                  </tbody>
                </table>
              </section>

              {calc.businessTerms?.length > 0 && (
                <section>
                  <h3 className="text-sm font-medium mb-2">商务条款</h3>
                  <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
                    {calc.businessTerms.filter((t: any) => t.enabled).map((t: any) => (
                      <li key={t.index}>{t.text}</li>
                    ))}
                  </ol>
                </section>
              )}

              {adjustments.length > 0 && (
                <section>
                  <h3 className="text-sm font-medium mb-2">人工调整记录</h3>
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-500">
                      <tr>
                        <th className="text-left py-1.5">字段</th>
                        <th className="text-right py-1.5">系统值</th>
                        <th className="text-right py-1.5">调整值</th>
                        <th className="text-left py-1.5">原因</th>
                        <th className="text-right py-1.5">时间</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {adjustments.map((a) => (
                        <tr key={a.id}>
                          <td className="py-1.5 font-mono text-xs">{a.field}</td>
                          <td className="py-1.5 text-right">{money(a.systemValue)}</td>
                          <td className="py-1.5 text-right font-medium">{money(a.adjustedValue)}</td>
                          <td className="py-1.5 text-gray-600">{a.reason || '—'}</td>
                          <td className="py-1.5 text-right text-xs text-gray-500">
                            {new Date(a.createdAt).toLocaleString('zh-CN')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
            </div>
          )}

          {tab === 'versions' && (
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500">
                <tr>
                  <th className="text-left py-1.5">版本</th>
                  <th className="text-right py-1.5">含税总价</th>
                  <th className="text-left py-1.5">变更说明</th>
                  <th className="text-right py-1.5">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {q.versions?.map((ver: any) => (
                  <tr key={ver.id}>
                    <td className="py-1.5">v{ver.versionNo}</td>
                    <td className="py-1.5 text-right">
                      {money((ver.calcResultJson as any)?.summary?.grandTotalIncVat)}
                    </td>
                    <td className="py-1.5 text-gray-600">{ver.changeNote || '—'}</td>
                    <td className="py-1.5 text-right text-xs text-gray-500">
                      {new Date(ver.createdAt).toLocaleString('zh-CN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'logs' && (
            <div className="space-y-1.5">
              {q.logs?.map((l: any) => (
                <div key={l.id} className="text-sm flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-40">
                    {new Date(l.createdAt).toLocaleString('zh-CN')}
                  </span>
                  <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">{l.action}</span>
                  <span className="text-gray-600">{l.detail}</span>
                </div>
              ))}
              {(!q.logs || q.logs.length === 0) && <p className="text-sm text-gray-400">暂无日志</p>}
            </div>
          )}
        </div>
      </div>

      {adjustOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6 z-50">
          <div className="bg-white rounded-lg w-full max-w-md shadow-xl">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="font-medium">人工调整（将记录系统值与调整值）</h2>
            </div>
            <div className="px-6 py-4 space-y-3">
              <label className="block text-sm">
                <span className="text-gray-600">调整字段</span>
                <select value={adjustForm.field} onChange={(e) => setAdjustForm({ ...adjustForm, field: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm">
                  <option value="grandTotalIncVat">含税总价</option>
                  <option value="moldTotalExVat">模具合计（不含税）</option>
                  <option value="injectionTotalExVat">注塑合计（不含税）</option>
                  <option value="unitCostExVat">单件成本</option>
                </select>
              </label>
              <div className="text-xs text-gray-500">
                系统计算值：{money(summary[adjustForm.field] ?? 0)}
              </div>
              <label className="block text-sm">
                <span className="text-gray-600">调整后金额</span>
                <input type="number" value={adjustForm.adjustedValue}
                  onChange={(e) => setAdjustForm({ ...adjustForm, adjustedValue: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" />
              </label>
              <label className="block text-sm">
                <span className="text-gray-600">调整原因</span>
                <input value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                  className="mt-1 w-full border border-gray-300 rounded px-2 py-1.5 text-sm" placeholder="如：老客户让利" />
              </label>
            </div>
            <div className="px-6 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setAdjustOpen(false)} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50">取消</button>
              <button onClick={submitAdjust} className="px-4 py-2 text-sm bg-gray-900 text-white rounded hover:bg-gray-800">保存调整</button>
            </div>
          </div>
        </div>
      )}

      <div className="text-xs text-gray-400">
        <Link to="/" className="hover:underline">返回工作台</Link>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <span className="text-gray-500">{label}：</span>
      <span>{value || '—'}</span>
    </div>
  );
}
