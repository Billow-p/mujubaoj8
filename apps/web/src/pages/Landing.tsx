import { Link } from 'react-router-dom';

const money = (n: number) => '¥' + n.toLocaleString('zh-CN');

/* ---------- 内联图标（Lucide 风格，无额外依赖） ---------- */
const Icon = ({ d, className = 'w-5 h-5' }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} className={className}>
    <path d={d} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const I = {
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  mail: 'M4 4h16v16H4zM22 6l-10 7L2 6',
};

/** 四步主流程 —— 与系统内「材料库 → 配置中心 → 报价」的实际使用顺序一致 */
const FLOW = [
  {
    n: 1,
    t: '材料库备价',
    d: '39 种主流材料预置好，改个价格就行。全系统唯一价格来源，改价只改这一处。',
  },
  {
    n: 2,
    t: '一键同步',
    d: '把材料库的价格同步进报价配置中心。材料库改价后点一下同步，全类型生效。',
  },
  {
    n: 3,
    t: '定费用算法',
    d: '收哪些费、怎么算，选计算方式填数字即可，右侧实时出价，不用写公式。',
  },
  {
    n: 4,
    t: '报价计算',
    d: '填数量自动出含税总价，导 Excel、发邮箱、客户点链接在线查看确认。',
    highlight: true,
  },
];

const TRUST = [
  { icon: I.shield, t: '缺什么，明说', d: '少参数、少价格都用中文告诉你补什么，绝不返回错误码、绝不瞎算。' },
  { icon: I.file, t: '一键交付', d: '报价单导出 Excel、邮件发客户、客户点链接在线查看并确认。' },
  { icon: I.users, t: '客户库沉淀', d: '报价历史自动归档到客户库，客户数据一键导出 Excel。' },
];

const MOLD_TYPES = ['注塑模具', '压铸模具', '双色模具', '橡胶模具'];

export default function Landing() {
  return (
    <div className="min-h-screen bg-white text-gray-900 antialiased">
      {/* ---------- 顶部导航 ---------- */}
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-md bg-gray-900 grid place-items-center text-white text-[12px] font-bold">M</span>
            <span className="font-semibold text-[14.5px]">模具注塑智能报价系统</span>
          </div>
          <div className="flex-1" />
          <Link to="/login" className="text-[13px] text-gray-600 hover:text-gray-900 px-3 py-1.5">登录</Link>
          <Link to="/login" className="text-[13px] bg-gray-900 hover:bg-gray-800 text-white rounded-lg px-4 py-1.5 font-medium">免费体验</Link>
        </div>
      </header>

      {/* ---------- Hero：一句话讲清价值 ---------- */}
      <section className="bg-gradient-to-b from-slate-50 to-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-5 pt-16 pb-12 text-center">
          <h1 className="text-[30px] md:text-[38px] leading-[1.3] font-bold">
            报模具价，不用再翻 Excel
            <br />
            <span className="text-blue-700">材料库备价 → 一键同步 → 自动算价</span>
          </h1>
          <p className="mt-4 text-[14px] text-gray-500 max-w-2xl mx-auto leading-6">
            注塑 / 压铸 / 双色 / 橡胶四套主流算法开箱即用。
            缺价格、缺参数都会中文提醒你补什么，绝不瞎算。
          </p>
          <div className="mt-7 flex items-center justify-center gap-3">
            <Link to="/login" className="bg-gray-900 hover:bg-gray-800 text-white rounded-lg px-6 py-2.5 text-[13.5px] font-medium">
              免费开始报价
            </Link>
            <a href="#flow" className="border border-gray-300 hover:border-gray-500 text-gray-700 rounded-lg px-6 py-2.5 text-[13.5px]">
              看看怎么算的
            </a>
          </div>
        </div>
      </section>

      {/* ---------- 四步流程：一眼看懂怎么用 ---------- */}
      <section id="flow" className="max-w-6xl mx-auto px-5 py-14">
        <h2 className="text-[20px] font-semibold text-center">四步跑通一张报价单</h2>
        <p className="text-center text-gray-400 text-[12.5px] mt-1.5">价格只维护一处（材料库），改价即生效</p>
        <div className="mt-8 flex gap-3 items-stretch flex-wrap lg:flex-nowrap">
          {FLOW.map((s, i) => (
            <div key={s.n} className="contents">
              {i > 0 && <div className="hidden lg:flex items-center text-gray-300 text-xl px-0.5">→</div>}
              <div
                className={`flex-1 min-w-[220px] rounded-xl border p-4 ${
                  s.highlight ? 'border-blue-400 bg-blue-50/40' : 'border-gray-200 bg-white'
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-md text-[12px] font-semibold grid place-items-center ${
                    s.highlight ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700'
                  }`}
                >
                  {s.n}
                </div>
                <h3 className="mt-2.5 text-[14px] font-medium">{s.t}</h3>
                <p className="mt-1.5 text-[12px] leading-5 text-gray-500">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- 放心点 ---------- */}
      <section className="bg-slate-50 border-y border-gray-100">
        <div className="max-w-6xl mx-auto px-5 py-12">
          <div className="grid sm:grid-cols-3 gap-4">
            {TRUST.map((t) => (
              <div key={t.t} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 grid place-items-center">
                  <Icon d={t.icon} />
                </div>
                <h3 className="mt-3 text-[13.5px] font-medium">{t.t}</h3>
                <p className="mt-1.5 text-[12px] leading-5 text-gray-500">{t.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- 模具类型 ---------- */}
      <section className="max-w-6xl mx-auto px-5 py-10 text-center">
        <div className="flex flex-wrap justify-center gap-2">
          {MOLD_TYPES.map((t) => (
            <span key={t} className="text-[12.5px] border border-gray-200 rounded-full px-4 py-1.5 text-gray-600">
              {t}
            </span>
          ))}
        </div>
      </section>

      {/* ---------- 底部 CTA ---------- */}
      <section className="max-w-6xl mx-auto px-5 pb-14">
        <div className="rounded-2xl bg-gray-900 text-center px-6 py-10">
          <h2 className="text-xl font-semibold text-white">现在就开始 · 2 分钟配好第一套报价</h2>
          <p className="text-gray-400 text-[13px] mt-2">配好材料库 → 点同步 → 建报价单，就这么简单</p>
          <Link
            to="/login"
            className="mt-6 inline-block bg-white text-gray-900 rounded-lg px-6 py-2.5 text-[13.5px] font-medium hover:bg-gray-100"
          >
            免费开始报价
          </Link>
        </div>
      </section>

      {/* ---------- 页脚 ---------- */}
      <footer className="border-t border-gray-200">
        <div className="max-w-6xl mx-auto px-5 py-6 flex flex-col md:flex-row items-center justify-between gap-3 text-[12px] text-gray-500">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded bg-gray-900 grid place-items-center text-white text-[10px] font-bold">M</span>
            模具注塑智能报价系统
          </div>
          <div className="flex items-center gap-4">
            <a href="mailto:729503962@qq.com" className="hover:text-gray-900 inline-flex items-center gap-1.5">
              <Icon d={I.mail} className="w-3.5 h-3.5" /> 729503962@qq.com
            </a>
            <Link to="/login" className="hover:text-gray-900">登录</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
