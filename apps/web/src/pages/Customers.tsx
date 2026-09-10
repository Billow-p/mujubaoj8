import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { customers } from '../api';

export default function Customers() {
  const [list, setList] = useState<any[]>([]);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<any | null>(null);
  const [quotes, setQuotes] = useState<any[]>([]);

  const load = (kw?: string) => {
    setLoading(true);
    customers.list(kw).then(setList).finally(() => setLoading(false));
  };
  useEffect(() => load(), []);

  const openDetail = async (c: any) => {
    setDetail(c);
    setQuotes(await customers.quotes(c.id));
  };

  const fmt = (n: number) => '¥' + Number(n).toLocaleString('zh-CN');

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">客户库</h1>
          <p className="text-sm text-gray-500 mt-1">客户信息与历史报价沉淀，点击客户查看其全部报价记录</p>
        </div>
        <div className="flex gap-2">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load(keyword)}
            placeholder="搜索名称/编号/联系人/电话"
            className="border border-gray-300 rounded px-3 py-2 text-sm w-64"
          />
          <button onClick={() => load(keyword)} className="border border-gray-300 px-4 py-2 rounded text-sm hover:bg-gray-50">
            搜索
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs">
            <tr>
              <th className="text-left px-4 py-2 font-medium">客户</th>
              <th className="text-left px-4 py-2 font-medium">联系人 / 电话</th>
              <th className="text-left px-4 py-2 font-medium">邮箱</th>
              <th className="text-right px-4 py-2 font-medium">报价数</th>
              <th className="text-right px-4 py-2 font-medium">成交数</th>
              <th className="text-right px-4 py-2 font-medium">最近报价金额</th>
              <th className="text-left px-4 py-2 font-medium">最近报价</th>
              <th className="text-right px-4 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">加载中…</td></tr>}
            {!loading && list.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">暂无客户，创建报价单时会自动入库</td></tr>
            )}
            {list.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-2">
                  <div className="font-medium">{c.name}</div>
                  {c.code && <div className="text-xs text-gray-400">{c.code}</div>}
                </td>
                <td className="px-4 py-2 text-gray-600">
                  {c.contactName || '—'}
                  <div className="text-xs text-gray-400">{c.phone || ''}</div>
                </td>
                <td className="px-4 py-2 text-gray-600 text-xs">{c.email || '—'}</td>
                <td className="px-4 py-2 text-right">{c.stats.totalQuotes}</td>
                <td className="px-4 py-2 text-right">{c.stats.confirmedCount}</td>
                <td className="px-4 py-2 text-right">
                  {c.stats.lastAmount != null ? fmt(c.stats.lastAmount) : '—'}
                </td>
                <td className="px-4 py-2 text-xs text-gray-500">
                  {c.stats.lastQuoteAt ? new Date(c.stats.lastQuoteAt).toLocaleDateString('zh-CN') : '—'}
                </td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => openDetail(c)} className="text-gray-600 hover:text-gray-900 text-xs px-2">
                    查看报价
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6 z-50">
          <div className="bg-white rounded-lg w-full max-w-3xl shadow-xl max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <div>
                <h2 className="font-medium">{detail.name} 的历史报价</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  共 {quotes.length} 条 · 成交 {detail.stats.confirmedCount} 条
                </p>
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600">关闭</button>
            </div>
            <div className="overflow-y-auto p-6">
              {quotes.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">该客户暂无报价记录</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-gray-500 text-xs">
                    <tr>
                      <th className="text-left py-2">报价编号</th>
                      <th className="text-left py-2">产品</th>
                      <th className="text-left py-2">状态</th>
                      <th className="text-right py-2">数量</th>
                      <th className="text-right py-2">含税总价</th>
                      <th className="text-right py-2">日期</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {quotes.map((q) => (
                      <tr key={q.id}>
                        <td className="py-2">
                          <Link to={`/quotes/${q.id}`} className="text-blue-600 hover:underline font-mono text-xs"
                            onClick={() => setDetail(null)}>
                            {q.quoteNo}
                          </Link>
                        </td>
                        <td className="py-2">{q.productName || '—'}</td>
                        <td className="py-2 text-xs text-gray-600">{q.status}</td>
                        <td className="py-2 text-right">{Number(q.firstOrderQty).toLocaleString()}</td>
                        <td className="py-2 text-right font-medium">{fmt(q.grandTotalIncVat)}</td>
                        <td className="py-2 text-right text-xs text-gray-500">
                          {new Date(q.createdAt).toLocaleDateString('zh-CN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
