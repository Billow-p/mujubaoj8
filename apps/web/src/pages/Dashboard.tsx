import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { quotes } from '../api';
import { useAuth } from '../store';

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  sent: '已发送',
  confirmed: '已成交',
  expired: '已过期',
};

const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  expired: 'bg-gray-200 text-gray-500',
};

export default function Dashboard() {
  const user = useAuth((s) => s.user);
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    quotes.list().then((data) => {
      setList(data);
      setLoading(false);
    });
  }, []);

  const stats = {
    total: list.length,
    draft: list.filter((q) => q.status === 'draft').length,
    sent: list.filter((q) => q.status === 'sent').length,
    confirmed: list.filter((q) => q.status === 'confirmed').length,
  };

  const handleExport = async (id: string) => {
    setExporting(id);
    try {
      await quotes.exportExcel(id);
    } catch (e: any) {
      alert('导出失败：' + (e.response?.data?.error || e.message));
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">报价单</h1>
          <p className="text-sm text-gray-500 mt-1">{user?.name}，这里汇总所有报价单；新建请点右侧按钮</p>
        </div>
        <Link
          to="/quotes/new"
          className="bg-gray-900 text-white px-4 py-2 rounded text-sm font-medium hover:bg-gray-800"
        >
          + 新建报价单
        </Link>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          ['报价总数', stats.total],
          ['草稿', stats.draft],
          ['已发送', stats.sent],
          ['已成交', stats.confirmed],
        ].map(([label, value]) => (
          <div key={label as string} className="bg-white border border-gray-200 rounded-lg p-5">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-2xl font-semibold mt-2">{value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-semibold text-sm">最近报价</h2>
          <span className="text-xs text-gray-500">最近 {list.length} 份</span>
        </div>
        {loading ? (
          <div className="p-10 text-center text-sm text-gray-500">加载中...</div>
        ) : list.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-gray-500 mb-4">还没有报价单</p>
            <div className="inline-flex flex-col gap-2 text-left text-[13px] text-gray-600">
              <span>
                ① 如果还没配置过模具类型，先到{' '}
                <Link to="/settings/config" className="text-gray-900 underline">设置 → 报价配置</Link>{' '}
                定义参数与费用项
              </span>
              <span>
                ② 然后点右上角{' '}
                <Link to="/quotes/new" className="text-gray-900 underline">+ 新建报价单</Link>
                ，选模具类型、填数据就能出价
              </span>
            </div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="text-left px-5 py-2.5">报价编号</th>
                <th className="text-left px-5 py-2.5">客户</th>
                <th className="text-left px-5 py-2.5">产品</th>
                <th className="text-right px-5 py-2.5">含税总价</th>
                <th className="text-center px-5 py-2.5">状态</th>
                <th className="text-left px-5 py-2.5">报价日期</th>
                <th className="text-center px-5 py-2.5">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.map((q) => (
                <tr key={q.id} className="hover:bg-gray-50">
                  <td className="px-5 py-2.5">
                    <Link to={`/quotes/${q.id}`} className="font-mono text-xs text-blue-600 hover:underline">
                      {q.quoteNo}
                    </Link>
                  </td>
                  <td className="px-5 py-2.5">{q.customerName}</td>
                  <td className="px-5 py-2.5">{q.productName}</td>
                  <td className="px-5 py-2.5 text-right">¥{(q.grandTotal || 0).toLocaleString()}</td>
                  <td className="px-5 py-2.5 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLOR[q.status]}`}>
                      {STATUS_LABEL[q.status] || q.status}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-xs text-gray-600">
                    {new Date(q.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-2.5 text-center whitespace-nowrap">
                    <Link
                      to={`/quotes/${q.id}`}
                      className="text-xs text-gray-600 border border-gray-200 px-2 py-1 rounded hover:bg-gray-50"
                    >
                      查看
                    </Link>
                    <button
                      onClick={() => handleExport(q.id)}
                      disabled={exporting === q.id}
                      className="text-xs text-blue-600 border border-blue-200 px-2 py-1 rounded hover:bg-blue-50 disabled:opacity-50 ml-1"
                    >
                      {exporting === q.id ? '导出中...' : '导出 Excel'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}