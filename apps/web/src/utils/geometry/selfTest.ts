/**
 * 几何解析自检：用已知尺寸的立方体验证体积 / 面积 / 包围盒。
 * 体积公式对不对，一眼就能看出来（边长³）。
 * 跑法：npx tsx apps/web/src/utils/geometry/selfTest.ts
 */

import { parseMeshFile } from './meshFormats';
import { summarize, guessUnitScale, computeVolume, computeSurfaceArea, isClosed } from './summary';
import type { MeshData } from './types';

let pass = 0;
let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// ---------- 造测试数据：边长 100mm 的立方体（体积 1e6 mm³，面积 6e4 mm²）----------
const S = 100;
const CUBE_V = S ** 3;
const CUBE_A = 6 * S * S;

const cubeVerts: number[][] = [
  [0, 0, 0], [S, 0, 0], [S, S, 0], [0, S, 0],
  [0, 0, S], [S, 0, S], [S, S, S], [0, S, S],
];
const cubeFaces: number[][] = [
  [0, 2, 1], [0, 3, 2], // 底
  [4, 5, 6], [4, 6, 7], // 顶
  [0, 1, 5], [0, 5, 4],
  [1, 2, 6], [1, 6, 5],
  [2, 3, 7], [2, 7, 6],
  [3, 0, 4], [3, 4, 7],
];

function toBinarySTL(): ArrayBuffer {
  const n = cubeFaces.length;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  cubeFaces.forEach((f, i) => {
    const o = 84 + i * 50;
    for (let k = 0; k < 3; k++) {
      const v = cubeVerts[f[k]];
      dv.setFloat32(o + 12 + k * 12, v[0], true);
      dv.setFloat32(o + 16 + k * 12, v[1], true);
      dv.setFloat32(o + 20 + k * 12, v[2], true);
    }
    dv.setUint16(o + 48, 0, true);
  });
  return buf;
}

function toAsciiSTL(): ArrayBuffer {
  const lines = ['solid cube'];
  for (const f of cubeFaces) {
    lines.push('  facet normal 0 0 0', '    outer loop');
    for (const vi of f) lines.push(`      vertex ${cubeVerts[vi].join(' ')}`);
    lines.push('    endloop', '  endfacet');
  }
  lines.push('endsolid cube');
  return new TextEncoder().encode(lines.join('\n')).buffer;
}

function toObj(): ArrayBuffer {
  const lines = cubeVerts.map((v) => `v ${v.join(' ')}`);
  for (const f of cubeFaces) lines.push(`f ${f.map((i) => i + 1).join(' ')}`);
  return new TextEncoder().encode(lines.join('\n')).buffer;
}

function toPlyAscii(): ArrayBuffer {
  const lines = [
    'ply', 'format ascii 1.0',
    `element vertex ${cubeVerts.length}`,
    'property float x', 'property float y', 'property float z',
    `element face ${cubeFaces.length}`,
    'property list uchar int vertex_indices',
    'end_header',
  ];
  for (const v of cubeVerts) lines.push(v.join(' '));
  for (const f of cubeFaces) lines.push(`3 ${f.join(' ')}`);
  return new TextEncoder().encode(lines.join('\n')).buffer;
}

// ---------- 直接测算法 ----------
console.log('【1】算法自检（直接构造网格）');
const cubeMesh: MeshData = {
  positions: new Float32Array(cubeVerts.flat()),
  indices: new Uint32Array(cubeFaces.flat()),
};
ok(`立方体体积 = ${CUBE_V}`, near(computeVolume(cubeMesh), CUBE_V, 1e-9), `实际 ${computeVolume(cubeMesh)}`);
ok(`立方体表面积 = ${CUBE_A}`, near(computeSurfaceArea(cubeMesh), CUBE_A, 1e-9), `实际 ${computeSurfaceArea(cubeMesh)}`);
ok('立方体是闭合的', isClosed(cubeMesh));

// 缺一个面的立方体 → 不闭合
const openMesh: MeshData = {
  positions: cubeMesh.positions,
  indices: new Uint32Array(cubeFaces.slice(1).flat()),
};
ok('缺一个面 → 不闭合', !isClosed(openMesh));

const s = summarize(cubeMesh);
ok('包围盒 size = [100,100,100]', s.bbox.size.every((x) => near(x, S, 1e-9)), JSON.stringify(s.bbox.size));
ok('面数 = 12', s.triangleCount === 12, String(s.triangleCount));
ok('顶点数 = 8', s.vertexCount === 8, String(s.vertexCount));

// ---------- 测各格式解析 ----------
console.log('\n【2】格式解析自检');
const cases: [string, () => ArrayBuffer | Promise<ArrayBuffer>][] = [
  ['STL(二进制)', () => toBinarySTL()],
  ['STL(文本)', () => toAsciiSTL()],
  ['OBJ', () => toObj()],
  ['PLY(文本)', () => toPlyAscii()],
];

for (const [label, make] of cases) {
  const buf = await make();
  const ext = label.toLowerCase().startsWith('stl') ? 'stl' : label.toLowerCase().startsWith('obj') ? 'obj' : 'ply';
  const r = await parseMeshFile(ext, buf, 'cube');
  if (!r.ok) {
    ok(`${label} 解析`, false, r.error);
    continue;
  }
  const sm = summarize(r.mesh);
  ok(
    `${label} → 体积 ${sm.volumeMm3.toFixed(0)} / 面积 ${sm.surfaceAreaMm2.toFixed(0)} / 闭合 ${sm.closed ? 'Y' : 'N'}`,
    near(sm.volumeMm3, CUBE_V, 1e-6) && near(sm.surfaceAreaMm2, CUBE_A, 1e-6) && sm.closed,
    JSON.stringify(sm.bbox.size),
  );
}

// ---------- 单位猜测 ----------
console.log('\n【3】单位猜测');
const g1 = guessUnitScale([100, 50, 20]);
ok(`100mm → mm（${g1.reason}）`, g1.unit === 'mm' && g1.scale === 1);
const g2 = guessUnitScale([2, 1, 0.5]);
ok(`2.0 → inch（${g2.reason}）`, g2.unit === 'inch' && g2.scale === 25.4);
const g3 = guessUnitScale([10, 5, 2]);
ok(`10 → cm（${g3.reason}）`, g3.unit === 'cm' && g3.scale === 10);

// ---------- 异常输入 ----------
console.log('\n【4】异常输入不崩');
for (const [label, buf, ext] of [
  ['空文件', new ArrayBuffer(0), 'stl'],
  ['乱码', new TextEncoder().encode('hello world not a mesh').buffer, 'obj'],
  ['截断的STL', toBinarySTL().slice(0, 120), 'stl'],
] as [string, ArrayBuffer, string][]) {
  const r = await parseMeshFile(ext, buf, 'bad');
  ok(`${label} → 优雅报错，不抛异常`, !r.ok || r.mesh.positions.length > 0, r.ok ? '居然解析成功了' : `(${r.error.slice(0, 24)})`);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
