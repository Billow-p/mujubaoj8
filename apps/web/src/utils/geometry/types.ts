/** 几何解析的公共类型（不依赖 DOM，浏览器 / Node 都能跑） */

/** 网格数据。positions 每 3 个 float 为一个顶点 (x,y,z) */
export interface MeshData {
  positions: Float32Array;
  /** 三角面索引；null 表示 positions 按 v0,v1,v2 顺序直接成面 */
  indices: Uint32Array | null;
  name?: string;
}

export type Vec3 = [number, number, number];

export interface BBox3 {
  min: Vec3;
  max: Vec3;
  /** 长宽高（= max - min） */
  size: Vec3;
}

/** 从 3D 数模算出来的几何量，用于自动填报价参数 */
export interface GeometrySummary {
  bbox: BBox3;
  /** 体积 mm³（只有闭合网格才准；非闭合会算出近似值） */
  volumeMm3: number;
  /** 表面积 mm² */
  surfaceAreaMm2: number;
  triangleCount: number;
  vertexCount: number;
  /** 网格是否闭合（闭合 = 体积可信） */
  closed: boolean;
}

/** 解析结果：成功带网格，失败带原因 */
export type ParseResult =
  | { ok: true; mesh: MeshData; format: MeshFormat; note?: string }
  | { ok: false; error: string };

export type MeshFormat = 'stl' | 'obj' | 'ply' | '3mf' | 'step' | 'iges' | 'brep';

/** 这些后缀我们能自己读，不需要 CAD 内核 */
export const SELF_PARSED_EXT = ['stl', 'obj', 'ply', '3mf'] as const;
/** 这些后缀需要 OpenCascade 内核 */
export const OCCT_EXT = ['step', 'stp', 'iges', 'igs', 'brep'] as const;
/** 专有格式：读不了，只能引导客户转 STEP */
export const VENDOR_EXT = ['sldprt', 'sldasm', 'prt', 'asm', 'ipt', 'iam', 'catpart', 'catproduct', 'x_t', 'x_b', 'sat', '3dxml', 'jt', 'fbx', 'dae', 'skp', 'prt.1'] as const;

/** 按文件名取后缀（小写、去掉查询串） */
export function extOf(name: string): string {
  const clean = name.split(/[?#]/)[0].toLowerCase();
  const i = clean.lastIndexOf('.');
  return i < 0 ? '' : clean.slice(i + 1);
}

/** 这个格式我们能不能真解析出几何 */
export function formatSupport(ext: string): 'self' | 'occt' | 'vendor' | 'unknown' {
  if ((SELF_PARSED_EXT as readonly string[]).includes(ext)) return 'self';
  if ((OCCT_EXT as readonly string[]).includes(ext)) return 'occt';
  if ((VENDOR_EXT as readonly string[]).includes(ext)) return 'vendor';
  return 'unknown';
}
