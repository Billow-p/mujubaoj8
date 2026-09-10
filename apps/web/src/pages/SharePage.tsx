import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { share } from '../api';

const money = (n: number | null | undefined) =>
  '¥' + Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const date = (s?: string | null) => (s ? new Date(s).toLocaleDateString('zh-CN') : '—');

/**
 * 客户查看报价单（免登录，凭分享 token）
 *
 * 刻意只展示「汇总 + 商务条款 + 产品规格」：
 * 客户能看到总价与单件成本，但看不到逐项成本构成与利润。
 * 后端已按此口径裁剪数据，前端不参与脱敏。
 */
export default function SharePage() {
  const { token = '' } = useParams();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmErr, setConfirmErr] = useState('');

  useEffect(() => {
    share
      .get(token)
      .then((d) => {
        setData(d);
        setConfirmed(!!d.alreadyConfirmed);
      })
      .catch((e) => setErr(e?.response?.data?.error || '链接无法打开，请与业务员联系'))
      .finally(() => setLoading(false));
  }, [token]);

  const onConfirm = async () => {
    setConfirming(true);
    setConfirmErr('');
    try {
      await share.confirm(token);
      setConfirmed(true);
    } catch (e: any) {
      setConfirmErr(e?.response?.data?.error || '确认失败，请稍后重试');
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center text-gray-400 text-sm">
        正在加载报价单…
      </div>
    );
  }

  if (err) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 max-w-md w-full p-8 text-center">
          <div className="text-2xl mb-3">🔗</div>
          <div className="text-gray-900 font-medium mb-2">链接无效</div>
          <div className="text-sm text-gray-500">{err}</div>
        </div>
      </div>
    );
  }

  const s = data.summary;

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        {/* 抬头 */}
        <div className="bg-slate-800 text-white px-8 py-5 flex items-center justify-between">
          <div className="text-lg font-semibold tracking-wide">{data.companyName || '模具报价单'}</div>
          <div className="text-sm text-slate-300">模具报价单</div>
        </div>

        {/* 单据信息 */}
        <div className="px-8 py-5 border-b border-gray-100 grid grid-cols-2 gap-y-3 text-sm">
          <div>
            <span className="text-gray-500">报价单号：</span>
            <span className="font-mono text-gray-900">{data.quoteNo}</span>
          </div>
          <div className="text-right">
            <span className="text-gray-500">版本：</span>
            <span className="text-gray-900">v{data.versionNo}</span>
          </div>
          <div>
            <span className="text-gray-500">报价日期：</span>
            <span className="text-gray-900">{date(data.createdAt)}</span>
          </div>
          <div className="text-right">
            <span className="text-gray-500">有效期至：</span>
            <span className={data.expired ? 'text-red-600 font-medium' : 'text-gray-900'}>
              {date(data.expiresAt)}
            </span>
          </div>
          <div>
            <span className="text-gray-500">客户：</span>
            <span className="text-gray-900">{data.customerName || '—'}</span>
          </div>
          <div className="text-right">
            <span className="text-gray-500">产品：</span>
            <span className="text-gray-900">{data.productName || '—'}</span>
          </div>
          {data.moldTypeName && (
            <div className="col-span-2">
              <span className="text-gray-500">模具类型：</span>
              <span className="text-gray-900">{data.moldTypeName}</span>
            </div>
          )}
        </div>

        {/* 过期提示 */}
        {data.expired && (
          <div className="mx-8 mt-6 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            此报价单已于 {date(data.expiresAt)} 过期，金额不再展示。如需继续合作，请联系业务员重新报价。
          </div>
        )}

        {/* 产品规格 */}
        {!data.expired && data.specs?.length > 0 && (
          <div className="px-8 pt-6">
            <div className="text-sm font-medium text-gray-900 mb-3">产品规格</div>
            <div className="grid grid-cols-4 gap-3">
              {data.specs.map((sp: any) => (
                <div key={sp.label} className="bg-gray-50 rounded px-3 py-2">
                  <div className="text-[11px] text-gray-500">{sp.label}</div>
                  <div className="text-[13px] text-gray-900 mt-0.5 truncate" title={sp.value}>
                    {sp.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 汇总 */}
        {!data.expired && s && (
          <div className="px-8 py-6">
            <div className="text-sm font-medium text-gray-900 mb-3">报价汇总</div>
            <div className="border border-gray-200 rounded">
              <div className="flex justify-between px-4 py-2.5 text-sm border-b border-gray-100">
                <span className="text-gray-600">模具费用（不含税）</span>
                <span className="tabular-nums text-gray-900">{money(s.moldExVat)}</span>
              </div>

              <div className="flex justify-between px-4 py-2.5 text-sm border-b border-gray-100">
                <div>
                  <div className="text-gray-600">注塑费用（不含税）</div>
                  {s.unitCost > 0 && s.injectionQty > 0 && (
                    <div className="text-[12px] text-gray-400 mt-0.5">
                      单件 {money(s.unitCost)} × {Number(s.injectionQty).toLocaleString()} 件
                    </div>
                  )}
                </div>
                <span className="tabular-nums text-gray-900 self-start">{money(s.injectionExVat)}</span>
              </div>

              <div className="flex justify-between px-4 py-2.5 text-sm border-b border-gray-100 bg-gray-50">
                <span className="text-gray-600">不含税合计</span>
                <span className="tabular-nums text-gray-900">{money(s.netExVat)}</span>
              </div>

              {s.taxRate > 0 && (
                <div className="flex justify-between px-4 py-2.5 text-sm border-b border-gray-100">
                  <span className="text-gray-600">增值税（{Math.round(s.taxRate * 100)}%）</span>
                  <span className="tabular-nums text-gray-900">{money(s.tax)}</span>
                </div>
              )}

              <div className="flex justify-between items-center px-4 py-3.5 bg-slate-800 text-white">
                <span className="text-sm">含税总价</span>
                <span className="text-xl font-semibold tabular-nums">{money(s.totalIncVat)}</span>
              </div>
            </div>
          </div>
        )}

        {/* 商务条款 */}
        {data.businessTerms?.length > 0 && (
          <div className="px-8 pb-6">
            <div className="text-sm font-medium text-gray-900 mb-3">商务条款</div>
            <ol className="space-y-1.5">
              {data.businessTerms.map((t: any, i: number) => (
                <li key={i} className="text-[13px] text-gray-600 leading-relaxed flex gap-2">
                  <span className="text-gray-400 shrink-0">{t.index ?? i + 1}.</span>
                  <span>{t.text}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* 确认 */}
        <div className="px-8 py-5 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-4">
          <div className="text-[12px] text-gray-400">
            {confirmed
              ? '您已确认此报价单，业务员会与您联系后续事宜。'
              : '确认后业务员将收到通知，并安排合同与生产。'}
          </div>
          {confirmed ? (
            <span className="shrink-0 text-sm text-green-700 border border-green-300 bg-green-50 rounded px-4 py-2">
              ✓ 已确认
            </span>
          ) : (
            <button
              onClick={onConfirm}
              disabled={confirming || data.expired}
              className="shrink-0 text-sm bg-slate-800 text-white rounded px-5 py-2 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {confirming ? '提交中…' : '确认接受此报价'}
            </button>
          )}
        </div>
        {confirmErr && (
          <div className="px-8 pb-4 text-[12px] text-red-600">{confirmErr}</div>
        )}
      </div>

      <div className="max-w-3xl mx-auto mt-4 text-center text-[11px] text-gray-400">
        本页面为报价单只读查看页，链接由业务员生成，请勿转发给无关人员。
      </div>
    </div>
  );
}
