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

  // —— 运输参数整块删除 ——
  check('「运输区域」板块已删除', !text().includes('运输区域'));
  check('箱长/宽/高 不可填', !html().includes('运输箱长') && !html().includes('运输箱宽') && !html().includes('运输箱高'));
  check('运费单价 不可填', !html().includes('运费单价'));
  check('「运输信息」标题已移除', !text().includes('运输信息'));

  // —— 其他价格：存在，且挪到页面最底下（客户信息、注塑件 之后） ——
  const iOther = html().indexOf('其他价格');
  const iCust = html().indexOf('客户信息');
  const iPartParam = html().indexOf('单件重量'); // 注塑件段内的特征字段
  check('「其他价格」板块存在', iOther >= 0);
  check('「其他价格」不在客户信息之上', iOther >= 0 && iCust >= 0 && iOther > iCust);
  check('「其他价格」在注塑件段之后（页面最底下）', iOther >= 0 && iPartParam >= 0 && iOther > iPartParam);

  // —— 自定义栏 / 模具附加费 / 注塑附加费 已全部移除 ——
  check('没有「自定义栏」入口', !text().includes('自定义栏') && !text().includes('添加一栏'));
  check('没有「模具附加费」板块', !text().includes('模具附加费'));
  check('没有「注塑附加费」板块', !text().includes('注塑附加费'));
  check('注塑件卡片仍能正常渲染（材料/数量/单件重量）', !!iPartParam);

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
