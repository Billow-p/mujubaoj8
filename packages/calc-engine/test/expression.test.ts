// 表达式求值器 — 单元测试
import { evaluateExpression } from '../src/expression.js';

const tests: { expr: string; scope: Record<string, number>; expected: number; allowed: string[] }[] = [
  { expr: '1 + 2 * 3', scope: {}, expected: 7, allowed: [] },
  { expr: '(1 + 2) * 3', scope: {}, expected: 9, allowed: [] },
  { expr: 'max(1, 2, 3)', scope: {}, expected: 3, allowed: [] },
  { expr: 'min(10, 5, 8)', scope: {}, expected: 5, allowed: [] },
  { expr: 'round(3.14159, 2)', scope: {}, expected: 3.14, allowed: [] },
  { expr: 'round(3.5)', scope: {}, expected: 4, allowed: [] },
  { expr: 'abs(-5)', scope: {}, expected: 5, allowed: [] },
  { expr: 'if(cavityCount > 2, 5000, 2000)', scope: { cavityCount: 4 }, expected: 5000, allowed: ['cavityCount'] },
  { expr: 'if(cavityCount > 2, 5000, 2000)', scope: { cavityCount: 1 }, expected: 2000, allowed: ['cavityCount'] },
  { expr: 'cavityCount * 800 + 5000', scope: { cavityCount: 4 }, expected: 8200, allowed: ['cavityCount'] },
  { expr: '-5 + 10', scope: {}, expected: 5, allowed: [] },
  { expr: '10 / 3', scope: {}, expected: 10 / 3, allowed: [] },
  { expr: '10 % 3', scope: {}, expected: 1, allowed: [] },
  { expr: 'coreLengthMm * coreWidthMm * coreHeightMm / 1000', scope: { coreLengthMm: 500, coreWidthMm: 400, coreHeightMm: 150 }, expected: 30000, allowed: ['coreLengthMm', 'coreWidthMm', 'coreHeightMm'] },
  // 负数优先级
  { expr: '2 * -3', scope: {}, expected: -6, allowed: [] },
  // 多层嵌套
  { expr: 'max(0, round(materialUnitPrice * singleWeightKg * 1.05, 2))', scope: { materialUnitPrice: 12, singleWeightKg: 0.18 }, expected: 2.27, allowed: ['materialUnitPrice', 'singleWeightKg'] },
  // AND / OR / NOT（PRD 4.2）
  { expr: '1 && 1', scope: {}, expected: 1, allowed: [] },
  { expr: '1 && 0', scope: {}, expected: 0, allowed: [] },
  { expr: '0 || 1', scope: {}, expected: 1, allowed: [] },
  { expr: '0 || 0', scope: {}, expected: 0, allowed: [] },
  { expr: '!0', scope: {}, expected: 1, allowed: [] },
  { expr: '!5', scope: {}, expected: 0, allowed: [] },
  { expr: 'a > 1 and b < 10', scope: { a: 5, b: 3 }, expected: 1, allowed: ['a', 'b'] },
  { expr: 'a > 1 and b > 10', scope: { a: 5, b: 3 }, expected: 0, allowed: ['a', 'b'] },
  { expr: 'a == 1 or b == 3', scope: { a: 5, b: 3 }, expected: 1, allowed: ['a', 'b'] },
  { expr: 'not (a > 1)', scope: { a: 5 }, expected: 0, allowed: ['a'] },
  { expr: 'if(a >= 2 && b <= 5, 100, 50)', scope: { a: 3, b: 4 }, expected: 100, allowed: ['a', 'b'] },
  { expr: 'if(a >= 2 && b <= 5, 100, 50)', scope: { a: 3, b: 9 }, expected: 50, allowed: ['a', 'b'] },
  { expr: 'if(a > 100 || b > 100, 999, 0)', scope: { a: 3, b: 200 }, expected: 999, allowed: ['a', 'b'] },
  // 花括号变量写法
  { expr: '{cavityCount} * 800', scope: { cavityCount: 4 }, expected: 3200, allowed: ['cavityCount'] },
  { expr: 'if({qty} > {threshold}, 1, 0)', scope: { qty: 500, threshold: 100 }, expected: 1, allowed: ['qty', 'threshold'] },
];

let pass = 0, fail = 0;
for (const t of tests) {
  try {
    const v = evaluateExpression(t.expr, t.scope, new Set(t.allowed));
    const ok = Math.abs(v - t.expected) < 1e-6;
    console.log(`${ok ? '✓' : '✗'}  ${t.expr}  =  ${v}  ${ok ? '' : `（期望 ${t.expected}）`}`);
    if (ok) pass++; else fail++;
  } catch (e: any) {
    console.log(`✗  ${t.expr}  →  ${e.message}`);
    fail++;
  }
}

// 错误用例
const errorTests: { expr: string; scope: any; allowed: string[]; errMatch: RegExp }[] = [
  { expr: '', scope: {}, allowed: [], errMatch: /空/ },
  { expr: 'undefinedVar + 1', scope: {}, allowed: [], errMatch: /未定义变量/ },
  { expr: '1 / 0', scope: {}, allowed: [], errMatch: /除数/ },
  { expr: 'evilFunc()', scope: {}, allowed: [], errMatch: /未知函数/ },
  { expr: '1 +', scope: {}, allowed: [], errMatch: /结束/ },
  { expr: 'eval("1+1")', scope: {}, allowed: [], errMatch: /未定义变量|意外|无法识别/ },
];

console.log('\n--- 错误用例（应该抛错） ---');
for (const t of errorTests) {
  try {
    const v = evaluateExpression(t.expr, t.scope, new Set(t.allowed));
    console.log(`✗  ${t.expr}  →  期望抛错，实际返回 ${v}`);
    fail++;
  } catch (e: any) {
    const ok = t.errMatch.test(e.message);
    console.log(`${ok ? '✓' : '✗'}  ${t.expr}  →  ${e.message}`);
    if (ok) pass++; else fail++;
  }
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);