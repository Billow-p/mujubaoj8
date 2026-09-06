import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { quotes } from '../api';
import { useAuth } from '../store';

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  pending: '审核中',
  approved: '已审核',
  rejected: '已退回',
  sent: '已发送',
  confirmed: '已确认',
  expired: '已过期',
};

const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  sent: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  expired: 'bg-gray-200 text-gray-500',
};

export default function Dashboard() {
  const user = useAuth((s) => s.user);
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    quotes.list().then((data) => {
      setList(data);
      setLoading(false);
    });
  }, []);

  const stats = {
    total: list.length,
    draft: list.filter((q) => q.status === 'draft').length,
    pending: list.filter((q) => q.status === 'pending').length,
    sent: list.filter((q) => q.status === 'sent').length,
    confirmed: list.filter((q) => q.status === 'confirmed').length,
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">早上好，{user?.name}</h1>
          <p className="text-sm text-gray-500 mt-1">欢迎使用模具注塑报价系统</p>
        </div>
        <Link
          to="/quotes/new"
          className="bg-gray-900 text-white px-4 py-2 rounded text-sm font-medium hover:bg-gray-800"
        >
          + 新建报价单
        </Link>
      </div>

      <div className="grid grid-cols-5 gap-4">
        {[
          ['报价总数', stats.total],
          ['草稿', stats.draft],
          ['审核中', stats.pending],
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
          <div className="p-10 text-center text-sm text-gray-500">
            暂无报价单。<Link to="/quotes/new" className="text-gray-900 underline">新建一个</Link>
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
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.map((q) => (
                <tr key={q.id} className="hover:bg-gray-50">
                  <td className="px-5 py-2.5 font-mono text-xs">{q.quoteNo}</td>
                  <td className="px-5 py-2.5">{q.customerName}</td>
                  <td className="px-5 py-2.5">{q.productName}</td>
                  <td className="px-5 py-2.5 text-right">¥{(q.grandTotal || 0).toLocaleString()}</td>
                  <td className="px-5 py-2.5 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLOR[q.status]}`}>
                      {STATUS_LABEL[q.status]}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-xs text-gray-600">
                    {new Date(q.createdAt).toLocaleDateString()}
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
