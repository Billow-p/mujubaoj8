import { useEffect, useState } from 'react';
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
  zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  db: 'M12 2c5 0 8 1.3 8 3v14c0 1.7-3 3-8 3s-8-1.3-8-3V5c0-1.7 3-3 8-3zM4 5c0 1.7 3 3 8 3s8-1.3 8-3M4 12c0 1.7 3 3 8 3s8-1.3 8-3',
  sync: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  calc: 'M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15v4M8 19h4',
};

/** 四步主流程 —— 与系统内「材料库 → 配置中心 → 报价」的实际使用顺序一致 */
const FLOW = [
  { n: 1, t: '材料库备价', d: '39 种主流材料预置好，改个价格就行。全系统唯一价格来源。', icon: I.db },
  { n: 2, t: '一键同步', d: '材料库改价后点一下同步，价格全类型生效，中间不改任何公式。', icon: I.sync },
  { n: 3, t: '定费用算法', d: '收哪些费、怎么算，选方式填数字即可，右侧实时出价，不用写公式。', icon: I.sliders },
  { n: 4, t: '报价计算', d: '填数量自动出含税总价，导 Excel、发邮箱、客户在线确认。', icon: I.calc, highlight: true },
];

const TRUST = [
  { icon: I.shield, t: '缺什么，明说', d: '少参数、少价格都用中文告诉你补什么，绝不返回错误码、绝不瞎算。' },
  { icon: I.file, t: '一键交付', d: '报价单导出 Excel、邮件发客户、客户点链接在线查看并确认。' },
  { icon: I.users, t: '客户库沉淀', d: '报价历史自动归档到客户库，客户数据一键导出 Excel。' },
];

const MOLD_TYPES = ['注塑模具', '压铸模具', '双色模具', '橡胶模具'];

/** 注册动态滚动播报（示意内容，可在代码里替换为真实数据） */
const TICKER = [
  '东莞恒鑫模具 刚刚完成注册',
  '深圳锦泰科技 3 分钟出了第一张报价单',
  '宁波伟业压铸 同步了材料库最新价格',
  '苏州精工注塑 导出了报价 Excel',
  '佛山瑞泰五金 客户在线确认了报价',
  '中山联盛塑胶 新建了双色模具配置',
  '东莞明记模具 完成了压铸模具报价',
];

const DEMO_ROWS = [
  { k: '模芯钢材费', v: 5888 },
  { k: 'CNC 加工费', v: 38400 },
  { k: '模架费', v: 8600 },
  { k: '机台费（0.54/件 × 5000）', v: 2700 },
  { k: '产品材料费（11.34/kg）', v: 11340 },
];
const DEMO_SUM = DEMO_ROWS.reduce((a, b) => a + b.v, 0);
const DEMO_TOTAL = DEMO_SUM + 7055 + 10088;

export default function Landing() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((i) => (i + 1) % TICKER.length), 2600);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="min-h-screen bg-[#f7f9fd] text-gray-900 antialiased overflow-x-hidden">
      <style>{`
        @keyframes floaty { 0%,100% { transform: translateY(0px); } 50% { transform: translateY(-12px); } }
        @keyframes pulseGlow { 0%,100% { opacity:.55; } 50% { opacity:.9; } }
        @keyframes tickerIn { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform: translateY(0); } }
        @media (prefers-reduced-motion: no-preference) {
          .floaty { animation: floaty 6s ease-in-out infinite; }
          .floaty-slow { animation: floaty 9s ease-in-out infinite; }
          .pulse-glow { animation: pulseGlow 5s ease-in-out infinite; }
          .ticker-item { animation: tickerIn .5s ease-out; }
        }
      `}</style>

      {/* ---------- 顶部导航 ---------- */}
      <header className="sticky top-0 z-30 border-b border-white/60 bg-white/75 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-5 h-14 flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-cyan-400 grid place-items-center text-white text-[12px] font-bold shadow-md shadow-blue-500/25">M</span>
            <span className="font-semibold text-[14.5px] tracking-tight">模具注塑智能报价系统</span>
          </div>
          <div className="flex-1" />
          <Link to="/login" className="text-[13px] text-gray-600 hover:text-gray-900 px-3 py-1.5">登录</Link>
          <Link to="/login" className="text-[13px] bg-gradient-to-r from-blue-600 to-cyan-500 text-white rounded-lg px-4 py-1.5 font-medium shadow-md shadow-blue-500/25 hover:opacity-90">
            免费体验
          </Link>
        </div>
      </header>

      {/* ---------- Hero：科技感光斑 + 网格 + 渐变标题 ---------- */}
      <section className="relative overflow-hidden">
        {/* 网格底纹 */}
        <div
          className="absolute inset-0 opacity-[0.5]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(59,130,246,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(59,130,246,0.06) 1px, transparent 1px)',
            backgroundSize: '36px 36px',
            maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
          }}
        />
        {/* 光斑 */}
        <div className="pulse-glow absolute -top-24 left-1/2 -translate-x-1/2 w-[720px] h-[360px] rounded-full bg-gradient-to-r from-blue-400/30 via-cyan-300/30 to-indigo-400/30 blur-3xl pointer-events-none" />
        <div className="floaty-slow absolute top-24 -left-16 w-56 h-56 rounded-full bg-cyan-300/25 blur-3xl pointer-events-none" />
        <div className="floaty absolute top-40 -right-10 w-64 h-64 rounded-full bg-indigo-400/25 blur-3xl pointer-events-none" />

        <div className="relative max-w-5xl mx-auto px-5 pt-16 pb-10 text-center">
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-emerald-700 border border-emerald-200 bg-emerald-50/80 backdrop-blur rounded-full px-3.5 py-1.5">
              <Icon d={I.users} className="w-3.5 h-3.5" />
              5000+ 工厂注册
            </span>
            <span className="inline-flex items-center gap-1.5 text-[12px] text-blue-700 border border-blue-200 bg-white/70 backdrop-blur rounded-full px-3.5 py-1.5 shadow-sm">
              <Icon d={I.zap} className="w-3.5 h-3.5" />
              注塑 · 压铸 · 双色 · 橡胶 · 四套算法开箱即用
            </span>
          </div>
          <h1 className="mt-5 text-[34px] md:text-[52px] leading-[1.18] font-bold tracking-tight">
            <span className="text-gray-400">以前算半天，</span>
            <br className="hidden md:block" />
            <span className="bg-gradient-to-r from-blue-600 via-sky-500 to-cyan-400 bg-clip-text text-transparent drop-shadow-sm">
              现在 3 分钟出报价
            </span>
          </h1>
          <p className="mt-5 text-[14.5px] text-gray-500 max-w-2xl mx-auto leading-7">
            材料库备价 → 一键同步 → 自动算价。
            缺价格、缺参数都会中文提醒你补什么，绝不瞎算。
          </p>

          {/* 流程胶囊 */}
          <div className="mt-7 flex items-center justify-center gap-2 flex-wrap">
            {['材料库备价', '一键同步', '配置费用', '3 分钟出报价'].map((s, i) => (
              <span key={s} className="flex items-center gap-2">
                {i > 0 && <span className="text-blue-300 text-sm">→</span>}
                <span
                  className={`text-[12.5px] rounded-full px-4 py-1.5 border backdrop-blur ${
                    i === 3
                      ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white border-transparent shadow-md shadow-blue-500/25'
                      : 'bg-white/80 border-blue-100 text-gray-700'
                  }`}
                >
                  {s}
                </span>
              </span>
            ))}
          </div>

          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              to="/login"
              className="bg-gradient-to-r from-blue-600 to-cyan-500 text-white rounded-xl px-7 py-3 text-[14px] font-medium shadow-lg shadow-blue-500/30 hover:opacity-90 hover:shadow-blue-500/40 transition"
            >
              免费开始报价
            </Link>
            <a href="#flow" className="border border-gray-300 bg-white/70 backdrop-blur hover:border-gray-500 text-gray-700 rounded-xl px-7 py-3 text-[14px] transition">
              看看怎么算的
            </a>
          </div>

          {/* 注册动态滚动播报 */}
          <div className="mt-6 flex justify-center">
            <div className="inline-flex items-center gap-2.5 bg-white/80 backdrop-blur border border-blue-100 rounded-full pl-4 pr-5 py-1.5 text-[12px] text-gray-600 shadow-sm max-w-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span className="relative h-5 flex-1 min-w-[180px] overflow-hidden text-left">
                <span key={tick} className="ticker-item absolute inset-0 truncate">
                  {TICKER[tick]}
                </span>
              </span>
              <span className="text-blue-200">|</span>
              <span className="text-blue-700 font-medium whitespace-nowrap">5000+ 工厂注册</span>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- 四步流程：玻璃卡片 ---------- */}
      <section id="flow" className="relative max-w-6xl mx-auto px-5 py-14">
        <h2 className="text-[22px] font-semibold text-center">四步跑通一张报价单</h2>
        <p className="text-center text-gray-400 text-[12.5px] mt-1.5">价格只维护一处（材料库），改价即生效</p>
        <div className="mt-9 flex gap-3 items-stretch flex-wrap lg:flex-nowrap">
          {FLOW.map((s, i) => (
            <div key={s.n} className="contents">
              {i > 0 && (
                <div className="hidden lg:flex items-center">
                  <span className="w-8 h-px bg-gradient-to-r from-blue-300 to-cyan-300" />
                  <span className="text-blue-400 text-lg -ml-1">→</span>
                </div>
              )}
              <div
                className={`floaty flex-1 min-w-[220px] rounded-2xl border p-5 backdrop-blur-sm transition hover:-translate-y-1 hover:shadow-xl hover:shadow-blue-500/10 ${
                  s.highlight
                    ? 'border-blue-300 bg-gradient-to-b from-blue-50/90 to-cyan-50/60 shadow-lg shadow-blue-500/10'
                    : 'border-white bg-white/70 shadow-sm'
                }`}
                style={{ animationDelay: `${i * 0.6}s` }}
              >
                <div className="flex items-center justify-between">
                  <div
                    className={`w-9 h-9 rounded-xl grid place-items-center text-white shadow-md ${
                      s.highlight
                        ? 'bg-gradient-to-br from-blue-600 to-cyan-500 shadow-blue-500/30'
                        : 'bg-gradient-to-br from-slate-700 to-slate-500 shadow-slate-500/20'
                    }`}
                  >
                    <Icon d={s.icon} className="w-[18px] h-[18px]" />
                  </div>
                  <span className={`text-[26px] font-bold leading-none ${s.highlight ? 'text-blue-200' : 'text-gray-200'}`}>
                    {s.n}
                  </span>
                </div>
                <h3 className="mt-3.5 text-[15px] font-semibold">{s.t}</h3>
                <p className="mt-1.5 text-[12px] leading-5 text-gray-500">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- 演示报价卡 + 放心点 ---------- */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-50/80 to-[#f7f9fd]" />
        <div className="pulse-glow absolute -bottom-32 left-1/3 w-[560px] h-[280px] rounded-full bg-blue-300/20 blur-3xl pointer-events-none" />
        <div className="relative max-w-6xl mx-auto px-5 py-14 grid lg:grid-cols-2 gap-8 items-center">
          {/* 报价卡 */}
          <div className="floaty rounded-2xl border border-white bg-white/80 backdrop-blur p-6 shadow-2xl shadow-blue-500/10">
            <div className="flex items-center justify-between text-[12px] text-gray-400">
              <span className="font-medium text-gray-600">实时报价预览 · 注塑模具</span>
              <span className="inline-flex items-center gap-1.5 text-emerald-600">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> 实时
              </span>
            </div>
            <div className="mt-4 space-y-2.5 text-[13px]">
              {DEMO_ROWS.map((r) => (
                <div key={r.k} className="flex items-center justify-between border-b border-dashed border-gray-100 pb-2">
                  <span className="text-gray-500">{r.k}</span>
                  <span className="tabular-nums font-medium">{money(r.v)}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-gray-200 flex items-center justify-between">
              <span className="text-[13px] text-gray-500">含税总价（利润 10% + 税 13%）</span>
              <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
                {money(DEMO_TOTAL)}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-gray-400">演示数据 · 登录后按你自己的规则实时计算</p>
          </div>

          {/* 放心点 */}
          <div className="space-y-4">
            <h2 className="text-[20px] font-semibold">让老板放心、让报价员省心的三件事</h2>
            {TRUST.map((t) => (
              <div key={t.t} className="flex gap-3.5 rounded-xl border border-white bg-white/70 backdrop-blur p-4 shadow-sm">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-600/10 to-cyan-400/10 text-blue-700 border border-blue-100 grid place-items-center shrink-0">
                  <Icon d={t.icon} />
                </div>
                <div>
                  <h3 className="text-[13.5px] font-medium">{t.t}</h3>
                  <p className="mt-1 text-[12px] leading-5 text-gray-500">{t.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- 模具类型 ---------- */}
      <section className="max-w-6xl mx-auto px-5 py-8 text-center">
        <div className="flex flex-wrap justify-center gap-2">
          {MOLD_TYPES.map((t) => (
            <span key={t} className="text-[12.5px] border border-blue-100 bg-white/70 rounded-full px-4 py-1.5 text-gray-600">
              {t}
            </span>
          ))}
        </div>
      </section>

      {/* ---------- 底部 CTA ---------- */}
      <section className="max-w-6xl mx-auto px-5 pb-16">
        <div className="relative overflow-hidden rounded-2xl bg-gray-900 text-center px-6 py-12">
          <div className="pulse-glow absolute -top-20 left-1/2 -translate-x-1/2 w-[480px] h-[240px] rounded-full bg-blue-500/30 blur-3xl pointer-events-none" />
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.12) 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
          />
          <div className="relative">
            <h2 className="text-xl font-semibold text-white">现在就开始 · 2 分钟配好第一套报价</h2>
            <p className="text-gray-400 text-[13px] mt-2">配好材料库 → 点同步 → 建报价单，就这么简单</p>
            <Link
              to="/login"
              className="mt-6 inline-block bg-gradient-to-r from-blue-500 to-cyan-400 text-white rounded-xl px-7 py-3 text-[13.5px] font-medium shadow-lg shadow-blue-500/40 hover:opacity-90"
            >
              免费开始报价
            </Link>
          </div>
        </div>
      </section>

      {/* ---------- 页脚 ---------- */}
      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-6xl mx-auto px-5 py-6 flex flex-col md:flex-row items-center justify-between gap-3 text-[12px] text-gray-500">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-600 to-cyan-400 grid place-items-center text-white text-[10px] font-bold">M</span>
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
