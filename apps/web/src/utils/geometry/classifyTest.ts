/**
 * 归类 / 参数建议自检。
 * 这两个是「系统建议 + 人工确认」的核心，判错了就直接报错价，必须验。
 * 跑法：npx tsx apps/web/src/utils/geometry/classifyTest.ts
 */

import { classify, suggestParams } from './index';
import { summarize } from './summary';
import type { MeshData, GeometrySummary } from './types';

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};

/** 造一个长方体网格（闭合），用于验证归类 */
function box(w: number, h: number, d: number): MeshData {
  const v = [
    [0, 0, 0], [w, 0, 0], [w, h, 0], [0, h, 0],
    [0, 0, d], [w, 0, d], [w, h, d], [0, h, d],
  ];
  const f = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ];
  return { positions: new Float32Array(v.flat()), indices: new Uint32Array(f.flat()) };
}

console.log('【1】归类判据（体积/表面积 比值）');
const cases: [string, [number, number, number], 'mold' | 'part'][] = [
  ['薄壁板 100×100×2（典型注塑件）', [100, 100, 2], 'part'],
  ['薄壁壳 200×150×1.5', [200, 150, 1.5], 'part'],
  ['小塑料件 50×30×2', [50, 30, 2], 'part'],
  ['实心块 100×100×100（模芯）', [100, 100, 100], 'mold'],
  ['大模胚 400×350×300', [400, 350, 300], 'mold'],
];

for (const [label, size, expect] of cases) {
  const s = summarize(box(size[0], size[1], size[2]));
  const c = classify(s);
  const ratio = s.volumeMm3 / s.surfaceAreaMm2;
  ok(
    `${label} → ${c.kind}（置信度 ${c.confidence}，比值 ${ratio.toFixed(2)}）`,
    c.kind === expect,
    `期望 ${expect}`,
  );
}

console.log('\n【2】低置信度必须能识别出来（不该盲信）');
// 60×60×8：比值 3.16，落在 1.5~4 的中间地带 —— 这种就必须让人来定
const mid = summarize(box(60, 60, 8));
const midC = classify(mid);
const midRatio = mid.volumeMm3 / mid.surfaceAreaMm2;
ok(
  `中间体型（比值 ${midRatio.toFixed(2)}）→ 置信度 ${midC.confidence} < 0.6，界面应要求人工确认`,
  midC.confidence < 0.6,
  `实际 ${midC.confidence}，判为 ${midC.kind}`,
);

console.log('\n【3】参数建议');
const shellS = summarize(box(100, 100, 2));
const shellP = suggestParams(shellS, 'part', 1.05);
const w = shellP.find((p) => p.name === '单件重量');
// 100*100*2 mm³ = 20000 mm³ = 20 cm³ × 1.05 = 21 g = 0.021 kg
ok(`注塑件单件重量 ${w?.value}kg（期望 0.021）`, Math.abs((w?.value ?? 0) - 0.021) < 1e-6, String(w?.value));
ok('注塑件建议含投影面积', shellP.some((p) => p.name === '投影面积'));
ok('注塑件不含模芯尺寸', !shellP.some((p) => p.name === '模芯长'));

const moldS = summarize(box(100, 100, 100));
const moldP = suggestParams(moldS, 'mold', 7.85);
const l = moldP.find((p) => p.name === '模芯长');
// 100 + 40*2 = 180
ok(`模具模芯长 ${l?.value}mm（期望 180 = 100 + 单边40×2）`, l?.value === 180, String(l?.value));
const mw = moldP.find((p) => p.name === '模具重量');
// 1e6 mm³ = 1000 cm³ × 7.85 = 7850 g = 7.85 kg
ok(`模具重量 ${mw?.value}kg（期望 7.85）`, Math.abs((mw?.value ?? 0) - 7.85) < 0.01, String(mw?.value));

console.log('\n【4】异常输入不崩');
const empty: GeometrySummary = {
  bbox: { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] },
  volumeMm3: 0, surfaceAreaMm2: 0, triangleCount: 0, vertexCount: 0, closed: false,
};
const ec = classify(empty);
ok(`空几何 → 低置信度 ${ec.confidence} 而非崩溃`, ec.confidence <= 0.3);
ok('空几何也能出参数建议（不抛异常）', Array.isArray(suggestParams(empty, 'part', 1)));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
