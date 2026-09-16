/**
 * 从网格算几何量 —— 报价要用的都在这：
 * 包围盒（→ 模芯长宽高）、体积（→ 单件重量 / 模具重量）、表面积、闭合性（→ 体积可不可信）。
 *
 * 全部是纯函数，不碰 DOM，可以直接在 Node 里跑测试。
 */

import type { MeshData, GeometrySummary, Vec3, BBox3 } from './types';

/** 超过这个面数就不做闭合检测了（太慢，报价场景也遇不到） */
const CLOSED_CHECK_MAX_TRIS = 300_000;

export function computeBBox(mesh: MeshData): BBox3 {
  const p = mesh.positions;
  if (!p.length) {
    return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const min: Vec3 = [minX, minY, minZ];
  const max: Vec3 = [maxX, maxY, maxZ];
  return { min, max, size: [maxX - minX, maxY - minY, maxZ - minZ] };
}

/** 取第 i 个三角形的三个顶点索引 */
function triIndices(mesh: MeshData, i: number): [number, number, number] {
  if (mesh.indices) {
    const n = mesh.indices;
    return [n[i * 3], n[i * 3 + 1], n[i * 3 + 2]];
  }
  return [i * 3, i * 3 + 1, i * 3 + 2];
}

export function triangleCount(mesh: MeshData): number {
  return mesh.indices ? Math.floor(mesh.indices.length / 3) : Math.floor(mesh.positions.length / 3);
}

/**
 * 体积（散度定理）：把每个三角形和原点组成的四面体有符号体积加起来。
 * 只有闭合网格才准；非闭合会得到近似值，靠 closed 字段告诉调用方信不信。
 */
export function computeVolume(mesh: MeshData): number {
  const p = mesh.positions;
  const n = triangleCount(mesh);
  let vol = 0;
  for (let i = 0; i < n; i++) {
    const [ia, ib, ic] = triIndices(mesh, i);
    const ax = p[ia * 3], ay = p[ia * 3 + 1], az = p[ia * 3 + 2];
    const bx = p[ib * 3], by = p[ib * 3 + 1], bz = p[ib * 3 + 2];
    const cx = p[ic * 3], cy = p[ic * 3 + 1], cz = p[ic * 3 + 2];
    // (a · (b × c)) / 6
    vol +=
      (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(vol);
}

/** 表面积：所有三角形面积之和 */
export function computeSurfaceArea(mesh: MeshData): number {
  const p = mesh.positions;
  const n = triangleCount(mesh);
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [ia, ib, ic] = triIndices(mesh, i);
    const ax = p[ia * 3], ay = p[ia * 3 + 1], az = p[ia * 3 + 2];
    const e1x = p[ib * 3] - ax, e1y = p[ib * 3 + 1] - ay, e1z = p[ib * 3 + 2] - az;
    const e2x = p[ic * 3] - ax, e2y = p[ic * 3 + 1] - ay, e2z = p[ic * 3 + 2] - az;
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    area += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
  }
  return area;
}

/**
 * 闭合性：每条边如果只被一个三角形用到，就是"边界边"（模型有洞）。
 * 没有边界边 = 闭合 = 体积可信。
 */
export function isClosed(mesh: MeshData): boolean {
  const n = triangleCount(mesh);
  if (n === 0) return false;
  if (n > CLOSED_CHECK_MAX_TRIS) return false;

  const edges = new Map<string, number>();
  const bump = (a: number, b: number) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const c = edges.get(key);
    if (c === undefined) edges.set(key, 1);
    else edges.set(key, c + 1);
  };
  for (let i = 0; i < n; i++) {
    const [a, b, c] = triIndices(mesh, i);
    if (a !== b) bump(a, b);
    if (b !== c) bump(b, c);
    if (c !== a) bump(c, a);
  }
  for (const count of edges.values()) {
    if (count !== 2) return false;
  }
  return true;
}

/** 把网格按给定缩放系数换算单位（例如 inch → mm 传 25.4） */
export function scaleMesh(mesh: MeshData, k: number): MeshData {
  if (k === 1) return mesh;
  const p = mesh.positions;
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i++) out[i] = p[i] * k;
  return { positions: out, indices: mesh.indices, name: mesh.name };
}

/** 一次性算出报价需要的全部几何量（单位统一按 mm 处理） */
export function summarize(mesh: MeshData): GeometrySummary {
  const bbox = computeBBox(mesh);
  return {
    bbox,
    volumeMm3: computeVolume(mesh),
    surfaceAreaMm2: computeSurfaceArea(mesh),
    triangleCount: triangleCount(mesh),
    vertexCount: Math.floor(mesh.positions.length / 3),
    closed: isClosed(mesh),
  };
}

// ---------------------------------------------------------------- 单位

/** 常见 3D 文件的单位 → 换算到 mm 的系数 */
export const UNIT_TO_MM: Record<string, number> = {
  mm: 1,
  millimeter: 1,
  cm: 10,
  m: 1000,
  inch: 25.4,
  in: 25.4,
  mil: 0.0254,
  ft: 304.8,
  um: 0.001,
};

/**
 * 猜单位：文件里没写单位时（STL/OBJ 常见），按包围盒大小猜。
 * 模具体量一般在几十到上千毫米，偏离太远就按 inch 处理更合理。
 * 返回的是建议值，界面上要让用户确认。
 */
export function guessUnitScale(bboxSize: Vec3): { unit: string; scale: number; reason: string } {
  const longest = Math.max(...bboxSize);
  if (longest <= 0) return { unit: 'mm', scale: 1, reason: '尺寸为 0，按 mm 处理' };
  if (longest < 3) return { unit: 'inch', scale: 25.4, reason: `最长边仅 ${longest.toFixed(2)}，像是以英寸为单位` };
  if (longest < 30) return { unit: 'cm', scale: 10, reason: `最长边 ${longest.toFixed(1)}，像是以厘米为单位` };
  if (longest > 20000) return { unit: 'um', scale: 0.001, reason: `最长边 ${Math.round(longest)}，数值过大，像是以微米为单位` };
  return { unit: 'mm', scale: 1, reason: `最长边 ${longest.toFixed(1)}，符合毫米量级` };
}
