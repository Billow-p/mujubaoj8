/*
 * 报价页（ConfiguredQuote）jsdom 渲染验证。
 *
 * 本机没有真机浏览器，这里渲染**真实页面组件**（api 换成固定假数据），验证：
 *   1) 公共参数（运输）整块已删除：运输区域 / 箱长宽高 / 运费单价 都不再出现
 *   2) 「其他价格」已挪到页面最底下（客户信息、注塑件段之后）
 *   3) 「自定义栏」「模具附加费」「注塑附加费」已移除
 *   4) 整页能正常渲染（不抛运行时报错）
 */

declare const require: any;

async function main() {
  const { JSDOM } = require('jsdom');

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/quote/new',
    pretendToBeVisual: true,
  });

  const g: any = globalThis;
  const setGlobal = (k: string, v: any) =>
    Object.defineProperty(g, k, { value: v, writable: true, configurable: true });
  setGlobal('window', dom.window);
  setGlobal('document', dom.window.document);
  setGlobal('navigator', dom.window.navigator);
  setGlobal('HTMLElement', dom.window.HTMLElement);
  setGlobal('HTMLInputElement', dom.window.HTMLInputElement);
  setGlobal('Event', dom.window.Event);
  setGlobal('MouseEvent', dom.window.MouseEvent);
  setGlobal('localStorage', dom.window.localStorage);
  setGlobal('getComputedStyle', dom.window.getComputedStyle);
  setGlobal('requestAnimationFrame', (cb: any) => setTimeout(() => cb(Date.now()), 0));
  setGlobal('cancelAnimationFrame', (id: any) => clearTimeout(id));
  setGlobal('IS_REACT_ACT_ENVIRONMENT', true);

  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { act } = require('react');
  const { MemoryRouter } = require('react-router-dom');
  const Page = require('../src/pages/ConfiguredQuote').default;

  const results: [string, boolean][] = [];
  const check = (label: string, cond: any) => results.push([label, !!cond]);
  const h = React.createElement;

  const container = dom.window.document.getElementById('root') as any;
  const root = createRoot(container);

  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: ['/quote/new'] }, h(Page)));
  });
  // 等两个 useEffect 里的 Promise 落地（moldTypes → cfg → 种子模具/注塑件）
  await act(async () => {
    await new Promise((r) => setTimeout(r, 120));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 120));
  });

  const html = () => container.innerHTML || '';
  const text = () => container.textContent || '';

  // —— 整页渲染 ——
  check('整页渲染成功（有「实时算价」）', text().includes('实时算价'));
  check('渲染出「客户信息」', text().includes('客户信息'));

  // —— 没有独立的「公共参数」板块：整单参数统一收进最底下的「其他价格」——
  check('没有独立的「公共参数」板块', !text().includes('公共参数'));
  check('「运输信息」标题已移除', !text().includes('运输信息'));

  // —— 其他价格：存在，且挪到页面最底下（客户信息、注塑件 之后） ——
  const iOther = html().indexOf('其他价格');
  const iCust = html().indexOf('客户信息');
  const iPartParam = html().indexOf('单件重量'); // 注塑件段内的特征字段
  check('「其他价格」板块存在', iOther >= 0);
  check('「其他价格」不在客户信息之上', iOther >= 0 && iCust >= 0 && iOther > iCust);
  check('「其他价格」在注塑件段之后（页面最底下）', iOther >= 0 && iPartParam >= 0 && iOther > iPartParam);

  // —— 「运输区域」已并入「其他价格」板块里编辑 ——
  const iZone = html().indexOf('运输区域');
  check('「运输区域」仍在页面上（不再被删）', iZone >= 0);
  check('「运输区域」位于「其他价格」板块之内（在其后）', iZone > iOther && iOther >= 0);
  const zoneSel = (Array.from(container.querySelectorAll('select')) as any[]).find((el) =>
    (el.textContent || '').includes('广东省内'),
  );
  check('「运输区域」是可编辑下拉（含省内外选项）', !!zoneSel);
  check('「整单参数」区标题存在', text().includes('整单参数'));
  // 箱尺寸 / 运费单价属于内部计价参数，不在报价单上占位置（值仍在库里参与算价）
  check('运输箱长 不在报价页显示', html().indexOf('运输箱长') === -1);
  check('运输箱宽 不在报价页显示', html().indexOf('运输箱宽') === -1);
  check('运输箱高 不在报价页显示', html().indexOf('运输箱高') === -1);
  check('运费单价 不在报价页显示', html().indexOf('运费单价') === -1);
  if (zoneSel) {
    const setSel = Object.getOwnPropertyDescriptor(
      (dom.window as any).HTMLSelectElement.prototype,
      'value',
    )!.set!;
    await act(async () => {
      setSel.call(zoneSel, '2');
      zoneSel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    check('切换「运输区域」后仍持有该值（可参与算价）', zoneSel.value === '2');
  }

  // —— 自定义栏 / 模具附加费 / 注塑附加费 已全部移除 ——
  check('没有「自定义栏」入口', !text().includes('自定义栏') && !text().includes('添加一栏'));
  check('没有「模具附加费」板块', !text().includes('模具附加费'));
  check('没有「注塑附加费」板块', !text().includes('注塑附加费'));
  check('注塑件卡片仍能正常渲染（材料/数量/单件重量）', !!iPartParam);

  // —— 公式类费用项：不在左栏卡片里铺开，只体现在右侧「实时算价」明细 ——
  const iRight = html().indexOf('实时算价');
  const iNewMold = html().indexOf('配置中心新增的模具费');
  check('公式类费用项不在左栏卡片里铺开（只在右侧算价里）', iRight >= 0 && iNewMold > iRight);
  check('公式类费用项在右侧明细里能算出值（¥ 500）', html().includes('¥ 500'));
  check('配置中心的预置项也在右侧明细里（设计费）', text().includes('设计费'));
  check('左栏只留「待填费用」区（手填金额类）', text().includes('待填费用'));

  // 方案B：无手填项时该区也要常驻，给空态说明（消除「配置中心加了项、报价页没反应」的误判）
  check('「待填费用」区标题常驻（无手填项时也在）', (html().match(/待填费用/g) ?? []).length >= 1);

  // 手填金额类（calcType=manual）以前在报价页没有任何输入入口 —— 必须是可填的
  const manualLabel = (Array.from(container.querySelectorAll('label')) as any[]).find((l) =>
    (l.textContent || '').includes('配置中心新增的手填费'),
  );
  const manualInput = manualLabel?.querySelector('input');
  check('手填类费用项在报价页有输入框', !!manualInput);
  if (manualInput) {
    const NativeInput = dom.window.HTMLInputElement as any;
    const setVal = Object.getOwnPropertyDescriptor(NativeInput.prototype, 'value')!.set!;
    await act(async () => {
      setVal.call(manualInput, '888');
      manualInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    check('手填金额能录入并参与算价（888 出现在页面）', text().includes('888'));
  }

  // 右栏「费用明细」默认展开 + 0 值项标「未设值」（否则新增的 0 元项完全看不见）
  check('右栏「费用明细」默认展开（显示「收起明细」）', text().includes('收起明细'));
  check('金额为 0 的费用项标成「未设值」', text().includes('未设值'));

  // 页面冗余说明文字已清除（用户明确要求「不要那么多废话」）
  check('标题下的「一套报价单可含多套模具…」说明文案已删除', !text().includes('一套报价单可含多套模具'));
  check('「价格从哪来（自动按顺序取）」提示块已删除', !text().includes('价格从哪来'));

  // 标题只留「新建报价单」，不再带「（多注塑件）」后缀
  check('标题后缀「（多注塑件）」已删除', !text().includes('多注塑件') && text().includes('新建报价单'));

  // 右栏只读「计价单价」区块已按需求删除（报价页不再展示单价）
  check('右栏只读「计价单价」区块已删除', !text().includes('计价单价'));
  check('「报价时不可改」标注已删除', !text().includes('报价时不可改'));

  await act(async () => { root.unmount(); });
  dom.window.close();

  console.log('\n报价页渲染验证（jsdom · 真实组件 ConfiguredQuote）');
  console.log('─'.repeat(56));
  for (const [label, ok] of results) console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  console.log('─'.repeat(56));
  const failed = results.filter((r) => !r[1]);
  if (failed.length) {
    console.error(`❌ 报价页验证失败 ${failed.length} 项`);
    process.exit(1);
  }
  console.log(`✅ 报价页验证通过（${results.length}/${results.length}）`);
  process.exit(0);
}

main().catch((e: any) => {
  console.error('❌ 报价页验证异常：', e);
  process.exit(1);
});
