/*
 * 三期（Excel 列映射）—— UI 交互验证（jsdom）。
 *
 * 本机没有可用的真机浏览器，「真机验证」降级为 jsdom：渲染**真实组件** SmartImport，
 * 模拟点击，验证「参数表导入」入口 → 面板展开 → 模板下载链接等按预期工作。
 *
 * 运行：node verify-third-phase.mjs（见仓库根目录），或单独：
 *   esbuild smartimportDom.ts --bundle --platform=node --format=cjs --external:jsdom --outfile=x.cjs
 *   NODE_PATH=<含 jsdom 的 node_modules> node x.cjs
 */

declare const require: any;

async function main() {
  const { JSDOM } = require('jsdom');

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  const g: any = globalThis;
  // Node 22 里 navigator / localStorage 是「只读 getter」，必须用 defineProperty 覆盖
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
  const { SmartImport } = require('../src/components/SmartImport');

  const h = React.createElement;
  const results: [string, boolean][] = [];
  const check = (label: string, cond: any) => results.push([label, !!cond]);

  const container = dom.window.document.getElementById('root') as any;
  const root = createRoot(container);

  await act(async () => {
    root.render(
      h(SmartImport, {
        molds: [{ uid: 'm1', name: '外壳模具' }],
        parts: [{ uid: 'p1', name: '外壳上盖' }],
        onApply: () => {},
        onImportParams: () => {},
        onError: () => {},
        onInfo: () => {},
      }),
    );
  });

  const text = () => container.textContent || '';
  const byText = (tag: string, needle: string) =>
    Array.from(container.querySelectorAll(tag)).find((el: any) => (el.textContent || '').includes(needle)) as any;

  // —— 初始态 ——
  check('渲染出「智能识别」标题', text().includes('智能识别'));
  check('渲染出原始拖拽区', text().includes('把文件拖到这里'));
  check('渲染出「参数表导入」入口按钮', !!byText('button', '参数表导入'));
  check('初始未展开三期面板', !text().includes('三期 · Excel 列映射'));

  // —— 点击入口 → 面板展开 ——
  const btn = byText('button', '参数表导入');
  await act(async () => {
    btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
  check('点击后按钮文案变「返回识别」', !!byText('button', '返回识别'));
  check('面板标题出现', text().includes('参数表导入（三期 · Excel 列映射）'));
  check('出现「选择参数表」提示', text().includes('选择参数表'));
  check('出现「下载模板」链接文案', text().includes('下载模板'));

  const link = container.querySelector('a[href="/templates/报价参数导入模板.xlsx"]') as any;
  check('模板下载链接指向 /templates/报价参数导入模板.xlsx', !!link);
  check('模板链接带 download 属性', !!link && link.hasAttribute('download'));
  check('存在 accept=".xlsx" 的文件选择框', !!container.querySelector('input[type="file"][accept=".xlsx"]'));

  // —— 再点一次 → 收起 ——
  await act(async () => {
    byText('button', '返回识别').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
  check('再次点击可收起（回到原始拖拽区）', text().includes('把文件拖到这里') && !text().includes('三期 · Excel 列映射'));

  await act(async () => { root.unmount(); });
  dom.window.close();

  console.log('\nUI 交互验证（jsdom · 真实组件 SmartImport）');
  console.log('─'.repeat(54));
  for (const [label, ok] of results) console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  console.log('─'.repeat(54));
  const failed = results.filter((r) => !r[1]);
  if (failed.length) {
    console.error(`❌ UI 验证失败 ${failed.length} 项`);
    process.exit(1);
  }
  console.log(`✅ UI 验证通过（${results.length}/${results.length}）`);
  process.exit(0);
}

main().catch((e: any) => {
  console.error('❌ UI 验证异常：', e);
  process.exit(1);
});
