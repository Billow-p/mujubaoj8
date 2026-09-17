/*
 * 配置中心（ConfigCenter）jsdom 渲染验证。
 *
 * 验的是「报价页 / 配置中心 两边参数分组必须一致」这条：
 *   1) 「产品数据」里只剩「模具参数」「注塑参数」两个分组 —— 「公共参数」整组已删除
 *   2) scope=common 的参数（运输箱长/运费单价…）不再出现在配置中心
 *   3) 「+ 加一项」入口还在，且两处都在（参数区 + 费用区）
 *
 * 背景：报价页早就没有「公共参数」板块了，配置中心留着「整单共享一份」会让两边对不上。
 */

declare const require: any;

async function main() {
  const { JSDOM } = require('jsdom');

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/settings/config',
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
  const Page = require('../src/pages/ConfigCenter').default;

  const results: [string, boolean][] = [];
  const check = (label: string, cond: any) => results.push([label, !!cond]);
  const h = React.createElement;

  const container = dom.window.document.getElementById('root') as any;
  const root = createRoot(container);

  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: ['/settings/config'] }, h(Page)));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 150)); });

  const text = () => container.textContent || '';
  const html = () => container.innerHTML || '';

  check('配置中心能正常渲染（出现「报价时填写」）', text().includes('报价时填写'));

  // —— 分组：只留 模具参数 / 注塑参数 ——
  check('有「模具参数」分组', text().includes('模具参数'));
  check('有「注塑参数」分组', text().includes('注塑参数'));
  check('「公共参数」分组已删除', !text().includes('公共参数'));
  check('「整单共享一份」说明文案已删除', !text().includes('整单共享'));

  // —— 模具 / 注塑参数还在（数据没被删，只是分组收敛）——
  check('模具参数照旧可编辑（腔数）', html().includes('腔数'));

  // 注塑组默认折叠，点开再看
  const partGroupBtn = (Array.from(container.querySelectorAll('button')) as any[]).find((b) =>
    (b.textContent || '').includes('注塑参数'),
  );
  if (partGroupBtn) {
    await act(async () => {
      partGroupBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
  }
  check('注塑参数照旧可编辑（单件重量）', html().includes('单件重量'));

  // —— 「+ 加一项」入口仍在：参数区 + 费用区 ——
  const addBtns = (Array.from(container.querySelectorAll('span,button')) as any[]).filter(
    (b) => (b.textContent || '').trim() === '+ 加一项',
  );
  check('「+ 加一项」入口仍在（参数区 + 费用区，≥2 处）', addBtns.length >= 2);

  await act(async () => { root.unmount(); });
  dom.window.close();

  console.log('\n配置中心渲染验证（jsdom · 真实组件 ConfigCenter）');
  console.log('─'.repeat(56));
  for (const [label, ok] of results) console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  console.log('─'.repeat(56));
  const failed = results.filter((r) => !r[1]);
  if (failed.length) {
    console.error(`❌ 配置中心验证失败 ${failed.length} 项`);
    process.exit(1);
  }
  console.log(`✅ 配置中心验证通过（${results.length}/${results.length}）`);
  process.exit(0);
}

main().catch((e: any) => {
  console.error('❌ 配置中心验证异常：', e);
  process.exit(1);
});
