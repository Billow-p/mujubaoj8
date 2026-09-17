/*
 * 配置中心（ConfigCenter）jsdom 渲染验证。
 *
 * 验两件事：
 *   ① 参数分组与报价页一致 —— 「产品数据」里只剩「模具参数」「注塑参数」，
 *      「公共参数（整单共享一份）」整组已删除
 *   ② 保存时不丢 scope —— 这是线上真实事故的回归测试：
 *      save() 漏传 scope → 后端按 `?? 'common'` 落库 → 每点一次保存，
 *      模具/注塑参数就被整批刷成「公共参数」，报价页参数整片消失。
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
  const { savedPayloads } = require('./stubApi');

  const NativeInput = dom.window.HTMLInputElement as any;
  const setVal = Object.getOwnPropertyDescriptor(NativeInput.prototype, 'value')!.set!;
  const setInput = async (el: any, v: string) => {
    await act(async () => {
      setVal.call(el, v);
      el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };
  const click = async (el: any) => {
    await act(async () => {
      el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
  };

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
  const inputs = () => Array.from(container.querySelectorAll('input')) as any[];
  const buttons = () => Array.from(container.querySelectorAll('button')) as any[];

  // ① 分组：与报价页统一
  check('配置中心能正常渲染（出现「报价时填写」）', text().includes('报价时填写'));
  check('有「模具参数」分组', text().includes('模具参数'));
  check('有「注塑参数」分组', text().includes('注塑参数'));
  check('「公共参数」分组已删除', !text().includes('公共参数'));
  check('「整单共享一份」说明文案已删除', !text().includes('整单共享'));

  // 模具组默认展开 → 参数照旧可编辑
  check('模具参数照旧可编辑（腔数）', html().includes('腔数'));
  check('「系数」黄色提示块已删除', !text().includes('下拉参数的数字不是金额'));

  // ② 保存不丢 scope（回归测试）—— 趁模具组还展开着先做
  const nameInput = inputs().find((i) => i.value === '腔数');
  check('找到模具参数「腔数」的输入框', !!nameInput);
  if (nameInput) await setInput(nameInput, '腔数X');

  const saveBtn = buttons().find((b) => (b.textContent || '').trim() === '保存');
  check('改动后「保存」按钮变为可点', !!saveBtn && !saveBtn.disabled);
  if (saveBtn) {
    await click(saveBtn);
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
  }
  const payload = savedPayloads[savedPayloads.length - 1];
  check('保存确实被调用', !!payload);
  if (payload) {
    const ps: any[] = payload.parameters ?? [];
    check('payload 里每个参数都带 scope', ps.length > 0 && ps.every((p) => !!p.scope));
    check('「腔数」保存时 scope=mold（不会被刷成 common）', ps.find((p) => p.name.startsWith('腔数'))?.scope === 'mold');
    check('「单件重量」保存时 scope=injection', ps.find((p) => p.name === '单件重量')?.scope === 'injection');
    check('「运输箱长」保存时 scope=common', ps.find((p) => p.name === '运输箱长')?.scope === 'common');
  }

  // 注塑组默认折叠，点开再看（手风琴：展开注塑会收起模具）
  const partGroupBtn = buttons().find((b) => (b.textContent || '').includes('注塑参数'));
  if (partGroupBtn) await click(partGroupBtn);
  check('注塑参数照旧可编辑（单件重量）', html().includes('单件重量'));

  // 「+ 加一项」入口仍在：参数区（模具/注塑）+ 费用区（模具费/注塑费）
  const addBtns = (Array.from(container.querySelectorAll('span,button')) as any[]).filter(
    (b) => (b.textContent || '').trim() === '+ 加一项',
  );
  check('「+ 加一项」入口仍在（参数区 + 费用区，≥2 处）', addBtns.length >= 2);

  // 「同步预置配置」按钮已移除（保存即同步，按钮冗余）
  check('「同步预置配置」按钮已删除', !text().includes('同步预置配置'));
  check('引导条里的「一键同步」按钮已删除', !text().includes('一键同步'));

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
