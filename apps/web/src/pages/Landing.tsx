import { Link } from 'react-router-dom';

/* ---------- 图标（Lucide 风格内联 SVG，避免额外依赖） ---------- */
const Icon = ({ d, className = 'w-6 h-6' }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className}>
    <path d={d} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const I = {
  cube: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96 12 12.01l8.73-5.05M12 22.08V12',
  layers: 'm12 2 9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 17l9 5 9-5',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  mail: 'M4 4h16v16H4zM22 6l-10 7L2 6',
  check: 'M20 6 9 17l-5-5',
  calc: 'M4 4h16v16H4zM8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01',
};

const FEATURES = [
  { icon: I.gear, t: '智能计价规则', d: '模架、钢材、CNC、EDM、线切割、热流道…按成本项逐项配置公式，改一次规则全站生效，告别 Excel 手算。' },
  { icon: I.cube, t: '注塑按件报价', d: '机台费、材料费、后加工费自动按件计算。机台时薪 × 成型周期 ÷ 3600 ÷ 腔数，大小件不再一个价。' },
  { icon: I.layers, t: '材料库统一维护', d: '塑料 / 钢材 / 合金共一份主数据，价格、密度、损耗率集中管理，改价一次全类型通用。' },
  { icon: I.zap, t: '一键出报价单', d: '填完参数实时算价，自动套利润与税率，生成可分享的报价单链接，客户微信打开即看。' },
  { icon: I.users, t: '客户与阶梯价', d: '客户资料归档，支持数量阶梯价，批量报价不混乱，历史报价随时调阅复用。' },
  { icon: I.share, t: '多模具类型', d: '注塑、压铸、双色、橡胶统一框架，配置各自的成本项与参数，一套系统管全厂报价。' },
];

const STEPS = [
  { n: 1, t: '配置计价规则', d: '在「计价规则」里设定各类费用项公式与默认参数，一次配好长期复用。' },
  { n: 2, t: '填写模具参数', d: '新建报价时填入模芯尺寸、腔数、机台、材料牌号等，系统实时重算。' },
  { n: 3, t: '生成报价单', d: '确认金额与条款，一键生成带企业信息的报价单，发给客户即刻可看。' },
];

const MOLD_TYPES = ['注塑模具', '压铸模具', '双色模具', '橡胶模具'];

/* 演示用报价单（模拟数据，仅展示） */
const DEMO_MOLD = [
  { k: '模架费', v: 8600 },
  { k: '模芯钢材费', v: 5888 },
  { k: 'CNC 加工费', v: 38400 },
  { k: 'EDM 放电费', v: 2200 },
  { k: '线切割费', v: 800 },
  { k: '设计费', v: 6000 },
  { k: '试模费', v: 5000 },
  { k: '运输费', v: 0 },
];
const DEMO_INJ = [
  { k: '机台费（0.54/件 × 5000）', v: 2700 },
  { k: '产品材料费（0.18kg × 牌号价）', v: 9450 },
  { k: '包装费（0.05/件）', v: 250 },
];
const money = (n: number) => '¥' + n.toLocaleString('zh-CN');
const DEMO_MOLD_SUM = DEMO_MOLD.reduce((a, b) => a + b.v, 0);
const DEMO_INJ_SUM = DEMO_INJ.reduce((a, b) => a + b.v, 0);
const DEMO_SUBTOTAL = DEMO_MOLD_SUM + DEMO_INJ_SUM;
const DEMO_PROFIT = Math.round(DEMO_SUBTOTAL * 0.12);
const DEMO_TAX = Math.round((DEMO_SUBTOTAL + DEMO_PROFIT) * 0.13);
const DEMO_TOTAL = DEMO_SUBTOTAL + DEMO_PROFIT + DEMO_TAX;

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#0b1020] text-gray-200 antialiased">
      {/* ---------- 顶部导航 ---------- */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0b1020]/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 grid place-items-center text-white font-bold">模</span>
            <span className="font-semibold text-white tracking-wide">模价通 · 模具注塑智能报价</span>
          </div>
          <nav className="hidden md:flex items-center gap-7 text-[13.5px] text-gray-300 ml-6">
            <a href="#features" className="hover:text-white">功能</a>
            <a href="#demo" className="hover:text-white">演示</a>
            <a href="#flow" className="hover:text-white">流程</a>
            <a href="#contact" className="hover:text-white">联系</a>
          </nav>
          <div className="flex-1" />
          <Link to="/login" className="text-[13.5px] text-gray-200 hover:text-white px-3 py-1.5">登录</Link>
          <Link to="/login" className="text-[13.5px] bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg px-4 py-1.5 font-medium">免费体验</Link>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_0%,rgba(99,102,241,0.25),transparent),radial-gradient(50%_40%_at_10%_20%,rgba(34,211,238,0.18),transparent)]" />
        <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)', backgroundSize: '44px 44px' }} />
        <div className="relative max-w-6xl mx-auto px-5 pt-20 pb-16 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <span className="inline-flex items-center gap-2 text-[12px] text-cyan-300 border border-cyan-400/30 bg-cyan-400/10 rounded-full px-3 py-1">
              <Icon d={I.zap} className="w-3.5 h-3.5" /> 让模具报价从 2 小时降到 2 分钟
            </span>
            <h1 className="mt-5 text-4xl md:text-[44px] leading-[1.15] font-bold text-white">
              模具注塑<br />智能报价系统
            </h1>
            <p className="mt-4 text-[15px] leading-7 text-gray-300 max-w-md">
              把模架、钢材、CNC、EDM、热流道、机台费…全部做成可配置的成本项。
              填好参数，价格实时算出来，一键生成可分享的报价单。
            </p>
            <div className="mt-7 flex items-center gap-3">
              <Link to="/login" className="bg-indigo-500 hover:bg-indigo-400 text-white rounded-lg px-5 py-2.5 text-[14px] font-medium">立即登录体验</Link>
              <a href="#demo" className="border border-white/20 hover:border-white/40 rounded-lg px-5 py-2.5 text-[14px] text-white">看演示 ▾</a>
            </div>
            <div className="mt-8 flex items-center gap-6 text-[12.5px] text-gray-400">
              <div><span className="text-white font-semibold text-lg">4</span> 类模具</div>
              <div><span className="text-white font-semibold text-lg">19+</span> 成本项</div>
              <div><span className="text-white font-semibold text-lg">100%</span> 可配置</div>
            </div>
          </div>

          {/* 悬浮报价卡 */}
          <div className="relative">
            <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-5 shadow-2xl">
              <div className="flex items-center justify-between text-[12.5px] text-gray-400">
                <span>报价单预览</span>
                <span className="text-cyan-300">● 实时</span>
              </div>
              <div className="mt-3 space-y-1.5 text-[13px]">
                <Row k="模架费" v={money(8600)} />
                <Row k="模芯钢材费" v={money(5888)} />
                <Row k="CNC 加工费" v={money(38400)} />
                <Row k="EDM 放电费" v={money(2200)} />
                <Row k="机台费（0.54/件）" v={money(2700)} />
              </div>
              <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between">
                <span className="text-[13px] text-gray-300">含税总价</span>
                <span className="text-xl font-bold text-white">{money(DEMO_TOTAL)}</span>
              </div>
            </div>
            <div className="absolute -bottom-5 -left-5 hidden md:block rounded-xl border border-white/10 bg-[#11182e] px-4 py-3 text-[12px] shadow-xl">
              <div className="text-gray-400">机台费自动算</div>
              <div className="text-white font-medium mt-0.5">时薪 × 周期 ÷ 3600 ÷ 腔数</div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- 功能 ---------- */}
      <section id="features" className="max-w-6xl mx-auto px-5 py-16">
        <h2 className="text-2xl font-bold text-white text-center">一个系统，管全厂报价</h2>
        <p className="text-center text-gray-400 text-[14px] mt-2">从成本规则到客户报价单，全流程在线</p>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.t} className="rounded-xl border border-white/10 bg-white/[0.03] hover:border-indigo-400/40 hover:bg-white/[0.06] transition p-5">
              <div className="w-11 h-11 rounded-lg bg-indigo-500/15 text-indigo-300 grid place-items-center"><Icon d={f.icon} /></div>
              <h3 className="mt-4 text-[15px] font-semibold text-white">{f.t}</h3>
              <p className="mt-2 text-[13px] leading-6 text-gray-400">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- 演示报价单 ---------- */}
      <section id="demo" className="max-w-6xl mx-auto px-5 py-16">
        <h2 className="text-2xl font-bold text-white text-center">报价单演示</h2>
        <p className="text-center text-gray-400 text-[14px] mt-2">一笔注塑模具报价长这样（演示数据）</p>
        <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
            <div>
              <div className="text-white font-semibold">XX 科技 · 注塑模具报价单</div>
              <div className="text-[12px] text-gray-400 mt-0.5">单号 MQ-2026-0912 · 2026-09-12</div>
            </div>
            <span className="text-[12px] text-gray-400">单位：元（含税）</span>
          </div>
          <div className="grid md:grid-cols-2 gap-px bg-white/10">
            <QuoteCol title="模具费用（一次性）" rows={DEMO_MOLD} sum={DEMO_MOLD_SUM} />
            <QuoteCol title="注塑费用（按件 × 5000）" rows={DEMO_INJ} sum={DEMO_INJ_SUM} />
          </div>
          <div className="px-6 py-4 grid md:grid-cols-2 gap-3 bg-white/[0.02]">
            <div className="text-[13px] text-gray-300 flex justify-between md:justify-start md:gap-6">
              <span>小计 <b className="text-white">{money(DEMO_SUBTOTAL)}</b></span>
              <span>利润(12%) <b className="text-white">{money(DEMO_PROFIT)}</b></span>
              <span>税(13%) <b className="text-white">{money(DEMO_TAX)}</b></span>
            </div>
            <div className="md:text-right flex items-center md:justify-end gap-2">
              <span className="text-[13px] text-gray-300">含税总价</span>
              <span className="text-2xl font-bold text-cyan-300">{money(DEMO_TOTAL)}</span>
            </div>
          </div>
        </div>
        <p className="text-center text-[12px] text-gray-500 mt-3">以上为演示数据，登录后按你自己的计价规则实时计算</p>
      </section>

      {/* ---------- 流程 ---------- */}
      <section id="flow" className="max-w-6xl mx-auto px-5 py-16">
        <h2 className="text-2xl font-bold text-white text-center">三步出报价</h2>
        <div className="mt-10 grid md:grid-cols-3 gap-5">
          {STEPS.map((s) => (
            <div key={s.n} className="relative rounded-xl border border-white/10 bg-white/[0.03] p-6">
              <div className="w-9 h-9 rounded-full bg-indigo-500 text-white grid place-items-center font-semibold">{s.n}</div>
              <h3 className="mt-4 text-[15px] font-semibold text-white">{s.t}</h3>
              <p className="mt-2 text-[13px] leading-6 text-gray-400">{s.d}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {MOLD_TYPES.map((t) => (
            <span key={t} className="text-[12.5px] border border-white/15 rounded-full px-3 py-1 text-gray-300">{t}</span>
          ))}
        </div>
      </section>

      {/* ---------- 联系 ---------- */}
      <section id="contact" className="max-w-6xl mx-auto px-5 py-16">
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-indigo-500/10 to-cyan-400/10 p-8 text-center">
          <h2 className="text-2xl font-bold text-white">想试用或对接你的报价规则？</h2>
          <p className="text-gray-300 text-[14px] mt-2">把你的成本项、材料价格发我，我帮你配进系统</p>
          <a href="mailto:729503962@qq.com" className="mt-6 inline-flex items-center gap-2 bg-white text-[#0b1020] rounded-lg px-5 py-2.5 font-medium hover:bg-gray-100">
            <Icon d={I.mail} className="w-5 h-5" /> 729503962@qq.com
          </a>
        </div>
      </section>

      {/* ---------- 页脚 ---------- */}
      <footer className="border-t border-white/10">
        <div className="max-w-6xl mx-auto px-5 py-8 flex flex-col md:flex-row items-center justify-between gap-3 text-[12.5px] text-gray-400">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded bg-gradient-to-br from-indigo-500 to-cyan-400 grid place-items-center text-white font-bold text-[12px]">模</span>
            模价通 · 模具注塑智能报价系统
          </div>
          <div className="flex items-center gap-4">
            <a href="mailto:729503962@qq.com" className="hover:text-white">邮箱：729503962@qq.com</a>
            <Link to="/login" className="hover:text-white">登录</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400">{k}</span>
      <span className="text-gray-100 tabular-nums">{v}</span>
    </div>
  );
}

function QuoteCol({ title, rows, sum }: { title: string; rows: { k: string; v: number }[]; sum: number }) {
  return (
    <div className="bg-[#0b1020] p-6">
      <div className="text-[13px] font-medium text-white mb-3">{title}</div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.k} className="flex items-center justify-between text-[13px]">
            <span className="text-gray-400 truncate pr-3">{r.k}</span>
            <span className="text-gray-100 tabular-nums shrink-0">{money(r.v)}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between text-[13px]">
        <span className="text-gray-300">小计</span>
        <span className="text-white font-semibold tabular-nums">{money(sum)}</span>
      </div>
    </div>
  );
}
