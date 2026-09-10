const fs = require('fs');
const p = 'C:/Users/Administrator/WorkBuddy/2026-09-06-15-54-15/mold-quote-system/prototype/config-onepage.html';
const code = fs.readFileSync(p, 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];

const mk = () => ({
  className: '', innerHTML: '', style: {}, textContent: '', value: '',
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  addEventListener() {}, focus() {}, files: [], click() {},
});
global.document = { getElementById: () => mk(), querySelectorAll: () => [], createElement: () => mk(), body: mk() };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.alert = () => {}; global.prompt = () => null; global.confirm = () => false;
global.Blob = function () {}; global.URL = { createObjectURL: () => '' }; global.FileReader = function () {};

let pass = 0, fail = 0;
const t = (n, got, exp) => {
  const ok = Math.abs(got - exp) < 1;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + n + ' = ' + got + (ok ? '' : '   expect ' + exp));
  ok ? pass++ : fail++;
};

const api = new Function(code + '\nreturn {calcAll,readable,money,setCalcType,DB,I};')();
const make = (k) => new Function(code.replace('renderBar();renderAll();', '') + '\nkey=' + JSON.stringify(k) + ';return {calcAll,money,readable};')();

console.log('--- 1. 页面初始化 ---');
console.log('  PASS  首次加载未卡死');
pass++;

console.log('--- 2. 注塑模具：5 种计算方式各算一遍 ---');
const run = api.calcAll();
const find = (n) => { const r = run.list.find((x) => x.it.n === n); return r ? r.v : NaN; };
t('模芯钢材费 (按尺寸算)', find('模芯钢材费'), 5887.5);
t('CNC加工费 (按工时算)', find('CNC 加工费'), 38400);
t('设计费 (固定金额)', find('设计费'), 6000);
t('试模费 (数量×单价)', find('试模费'), 5000);
t('管理费 (按比例算)', find('管理费'), 8293);
t('模具费用合计', run.mold, 5887.5 + 38400 + 6000 + 5000 + 8293);

console.log('--- 3. 边界：坏公式不卡死、不影响别的项 ---');
const base = api.I().length;
api.I().push({ n:'空公式', c:'自定义', s:'模具', on:true, calc:{ t:'formula' }, f:'' });
api.I().push({ n:'写一半', c:'自定义', s:'模具', on:true, calc:{ t:'formula' }, f:'腔数 乘以' });
api.I().push({ n:'除以零', c:'自定义', s:'模具', on:true, calc:{ t:'formula' }, f:'腔数 除以 0' });
api.I().push({ n:'参数被删', c:'自定义', s:'模具', on:true, calc:{ t:'formula' }, f:'已删除的参数 加上 1' });
const r2 = api.calcAll();
console.log('  PASS  4 个坏公式未卡死页面');
pass++;
r2.list.slice(-4).forEach((x) => {
  console.log('         ' + (x.it.n + '        ').slice(0, 8) + ' -> ' + (x.err ? x.err : '值 ' + api.money(x.v)));
  if (x.err || x.v === 0) pass++; else fail++;
});
t('坏公式不影响正常项', r2.mold, run.mold);
api.I().splice(base, 4);

console.log('--- 4. 切换计算方式（含智能猜参数） ---');
api.setCalcType(0, 'fixed');
t('切固定金额', api.calcAll().list.find((x) => x.it.n === '模芯钢材费').v, 0);
api.setCalcType(0, 'size');
const it0 = api.I()[0];
console.log('        自动猜到的参数：长=' + it0.calc.v.l + ' 宽=' + it0.calc.v.w + ' 高=' + it0.calc.v.h + ' 单价=' + it0.calc.v.priceVar);
t('切回按尺寸且猜对参数', api.calcAll().list.find((x) => x.it.n === '模芯钢材费').v, 5887.5);
if (it0.calc.v.l === '模芯长' && it0.calc.v.w === '模芯宽' && it0.calc.v.priceVar === '钢材单价') pass++;
else { console.log('  FAIL  参数猜测不正确'); fail++; }
api.setCalcType(0, 'manual');
t('切报价时手填', api.calcAll().list.find((x) => x.it.n === '模芯钢材费').manual ? 1 : 0, 1);
api.setCalcType(0, 'size');

console.log('--- 5. 停用不参与计算（管理费应随基数联动下降） ---');
const before = api.calcAll().mold;
api.I()[1].on = false;
const subAfter = 5887.5 + 6000 + 5000;
t('停用 CNC 后合计（含管理费联动）', api.calcAll().mold, subAfter + Math.round(subAfter * 0.15));
api.I()[1].on = true;
t('重新启用后恢复', api.calcAll().mold, before);

console.log('--- 6. 三种模具类型都能算 ---');
['injection', 'diecast', 'twocolor'].forEach((k) => {
  const m = make(k);
  const r = m.calcAll();
  console.log('  PASS  ' + api.DB.types[k].name + ' 模具费用合计 = ' + m.money(r.mold));
  r.list.forEach((x) => {
    if (x.err) console.log('        [该项有问题] ' + x.it.n + ' -> ' + x.err);
  });
  if (r.mold > 0) pass++; else fail++;
});

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
