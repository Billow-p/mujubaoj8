/**
 * 网格格式解析：STL / OBJ / PLY / 3MF。
 *
 * 全部自研、零第三方依赖 —— 没有许可风险，也省掉几 MB 的包体。
 * 输入 ArrayBuffer，输出统一的 MeshData（顶点 + 三角面索引）。
 * 顶点会做去重合并，这样后面才能判断网格是否闭合（闭合才意味着体积可信）。
 */

import type { MeshData, ParseResult } from './types';
import { unzip } from './zip';

/** 顶点去重：把坐标量化成字符串当键，相同坐标复用同一个索引 */
class VertexWelder {
  private map = new Map<string, number>();
  private pos: number[] = [];
  /** 量化精度：1e-4 足够区分不同点，又能吸收浮点噪声 */
  private q = 1e4;

  add(x: number, y: number, z: number): number {
    const key = `${Math.round(x * this.q)},${Math.round(y * this.q)},${Math.round(z * this.q)}`;
    const hit = this.map.get(key);
    if (hit !== undefined) return hit;
    const idx = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.map.set(key, idx);
    return idx;
  }

  /** 索引数超过 65535 也没关系，统一用 Uint32 */
  build(indices: number[]): MeshData {
    return {
      positions: new Float32Array(this.pos),
      indices: indices.length ? new Uint32Array(indices) : null,
    };
  }
}

// ---------------------------------------------------------------- STL

function parseStl(buf: ArrayBuffer): MeshData {
  const bytes = new Uint8Array(buf);
  const dv = new DataView(buf);

  // 先看是不是文本格式：开头必须是 solid 且后面能匹配到 facet/vertex
  const head = new TextDecoder('ascii', { fatal: false })
    .decode(bytes.subarray(0, Math.min(256, bytes.length)))
    .toLowerCase();
  const looksAscii = head.startsWith('solid') && /vertex|facet/.test(head);

  // 二进制判据：文件长度恰好等于 84 + n*50
  const fitsBinary = bytes.length >= 84 && (bytes.length - 84) % 50 === 0;
  const nTri = fitsBinary ? dv.getUint32(80, true) : 0;
  const sizeMatches = fitsBinary && bytes.length === 84 + nTri * 50;

  if (!looksAscii && sizeMatches) return parseStlBinary(dv, nTri);
  if (looksAscii && !sizeMatches) return parseStlAscii(bytes);
  // 两种都像：优先按二进制（长度对得上更可信）
  if (sizeMatches) return parseStlBinary(dv, nTri);
  return parseStlAscii(bytes);
}

function parseStlBinary(dv: DataView, nTri: number): MeshData {
  const w = new VertexWelder();
  const idx: number[] = [];
  for (let i = 0; i < nTri; i++) {
    const o = 84 + i * 50 + 12; // 跳过 12 字节法线
    const a = w.add(dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true));
    const b = w.add(dv.getFloat32(o + 12, true), dv.getFloat32(o + 16, true), dv.getFloat32(o + 20, true));
    const c = w.add(dv.getFloat32(o + 24, true), dv.getFloat32(o + 28, true), dv.getFloat32(o + 32, true));
    // 退化三角形（三点共点）丢掉
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  return w.build(idx);
}

function parseStlAscii(bytes: Uint8Array): MeshData {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // 逐行取 vertex 后的三个浮点数
  const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  const w = new VertexWelder();
  const idx: number[] = [];
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    const v = w.add(Number(m[1]), Number(m[2]), Number(m[3]));
    idx.push(v);
    n++;
  }
  if (n < 3) throw new Error('STL 文本里没读到顶点');
  return w.build(idx);
}

// ---------------------------------------------------------------- OBJ

function parseObj(buf: ArrayBuffer): MeshData {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf));
  const w = new VertexWelder();
  const verts: number[] = []; // 原始顶点在 welder 里的索引，按出现顺序
  const idx: number[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      verts.push(w.add(Number(p[1]) || 0, Number(p[2]) || 0, Number(p[3]) || 0));
    } else if (line.startsWith('f ')) {
      const parts = line.split(/\s+/).slice(1);
      const face: number[] = [];
      for (const tok of parts) {
        // 形如 "1"、"1/2/3"、"1//3"、"-1"
        const seg = tok.split('/')[0];
        let vi = Number(seg);
        if (!Number.isFinite(vi)) continue;
        // OBJ 索引从 1 开始；负数表示从当前末尾倒数
        vi = vi > 0 ? vi - 1 : verts.length + vi;
        const v = verts[vi];
        if (v !== undefined) face.push(v);
      }
      // 多边形扇形三角化（四边形最常见）
      for (let i = 1; i + 1 < face.length; i++) idx.push(face[0], face[i], face[i + 1]);
    }
  }
  if (!verts.length) throw new Error('OBJ 里没读到顶点');
  return w.build(idx);
}

// ---------------------------------------------------------------- PLY

const PLY_TYPE_SIZE: Record<string, number> = {
  char: 1, uchar: 1, int8: 1, uint8: 1,
  short: 2, ushort: 2, int16: 2, uint16: 2,
  int: 4, uint: 4, int32: 4, uint32: 4, float32: 4, float: 4,
  double: 8, float64: 8,
};

function readPlyValue(dv: DataView, off: number, type: string, little: boolean): number {
  const t = type.toLowerCase();
  switch (t) {
    case 'char': case 'int8': return dv.getInt8(off);
    case 'uchar': case 'uint8': return dv.getUint8(off);
    case 'short': case 'int16': return dv.getInt16(off, little);
    case 'ushort': case 'uint16': return dv.getUint16(off, little);
    case 'int': case 'int32': return dv.getInt32(off, little);
    case 'uint': case 'uint32': return dv.getUint32(off, little);
    case 'float': case 'float32': return dv.getFloat32(off, little);
    case 'double': case 'float64': return dv.getFloat64(off, little);
    default: return 0;
  }
}

function parsePly(buf: ArrayBuffer): MeshData {
  const bytes = new Uint8Array(buf);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== 'ply\n' && magic !== 'ply\r') throw new Error('不是 PLY 文件');

  // header 以 "end_header" 结尾
  const headBytes = bytes.subarray(0, Math.min(bytes.length, 1 << 16));
  const headText = new TextDecoder('ascii', { fatal: false }).decode(headBytes);
  const endIdx = headText.indexOf('end_header');
  if (endIdx < 0) throw new Error('PLY 文件头不完整');
  const dataStart = headText.indexOf('\n', endIdx) + 1;

  const lines = headText.slice(0, endIdx).split(/\r?\n/);
  let format = 'ascii';
  let vertexCount = 0;
  let faceCount = 0;
  let vertexProps: { name: string; type: string }[] = [];
  let faceIndexType = 'uint32';
  let inVertex = false;
  let inFace = false;

  for (const l of lines) {
    const t = l.trim();
    if (t.startsWith('format ')) format = t.split(/\s+/)[1];
    else if (t.startsWith('element ')) {
      const [, name, cnt] = t.split(/\s+/);
      inVertex = name === 'vertex';
      inFace = name === 'face';
      if (inVertex) {
        vertexCount = Number(cnt) || 0;
        vertexProps = []; // 注意：只在进入 vertex 段时清空，否则会被 face 段冲掉
      }
      if (inFace) faceCount = Number(cnt) || 0;
    } else if (t.startsWith('property list') && inFace) {
      // property list uchar int vertex_indices
      faceIndexType = t.split(/\s+/)[3] || 'int';
    } else if (t.startsWith('property ') && !t.startsWith('property list') && inVertex) {
      const p = t.split(/\s+/);
      vertexProps.push({ name: p[2], type: p[1] });
    }
  }

  const xi = vertexProps.findIndex((p) => p.name === 'x');
  const yi = vertexProps.findIndex((p) => p.name === 'y');
  const zi = vertexProps.findIndex((p) => p.name === 'z');
  if (xi < 0 || yi < 0 || zi < 0) throw new Error('PLY 缺少 x/y/z 坐标属性');

  const w = new VertexWelder();
  const idx: number[] = [];

  if (format === 'ascii' || format === 'ascii_1.0') {
    const text = new TextDecoder('ascii', { fatal: false }).decode(bytes.subarray(dataStart));
    const nums = text.trim().split(/\s+/).map(Number);
    const stride = vertexProps.length;
    for (let i = 0; i < vertexCount; i++) {
      const base = i * stride;
      w.add(nums[base + xi] || 0, nums[base + yi] || 0, nums[base + zi] || 0);
    }
    let p = vertexCount * stride;
    for (let i = 0; i < faceCount; i++) {
      const n = nums[p++];
      const f: number[] = [];
      for (let k = 0; k < n; k++) f.push(nums[p++]);
      for (let k = 1; k + 1 < f.length; k++) idx.push(f[0], f[k], f[k + 1]);
    }
    return w.build(idx);
  }

  // 二进制：按属性顺序算偏移
  const little = format === 'binary_little_endian';
  const dv = new DataView(buf);
  const offsets: number[] = [];
  let acc = 0;
  for (const p of vertexProps) {
    offsets.push(acc);
    acc += PLY_TYPE_SIZE[p.type.toLowerCase()] ?? 4;
  }
  const vertexStride = acc;

  let off = dataStart;
  for (let i = 0; i < vertexCount; i++) {
    const base = off + i * vertexStride;
    w.add(
      readPlyValue(dv, base + offsets[xi], vertexProps[xi].type, little),
      readPlyValue(dv, base + offsets[yi], vertexProps[yi].type, little),
      readPlyValue(dv, base + offsets[zi], vertexProps[zi].type, little),
    );
  }
  off += vertexCount * vertexStride;
  for (let i = 0; i < faceCount; i++) {
    const n = readPlyValue(dv, off, 'uchar', little);
    off += 1;
    const f: number[] = [];
    for (let k = 0; k < n; k++) {
      f.push(readPlyValue(dv, off, faceIndexType, little));
      off += PLY_TYPE_SIZE[faceIndexType.toLowerCase()] ?? 4;
    }
    for (let k = 1; k + 1 < f.length; k++) idx.push(f[0], f[k], f[k + 1]);
  }
  return w.build(idx);
}

// ---------------------------------------------------------------- 3MF

async function parse3mf(buf: ArrayBuffer): Promise<MeshData> {
  const entries = await unzip(new Uint8Array(buf));
  // 3MF 规范里模型文件固定叫 3D/3dmodel.model，实际大小写都有
  const model =
    entries.find((e) => /^3d\/3dmodel\.model$/i.test(e.name)) ??
    entries.find((e) => /\.model$/i.test(e.name));
  if (!model) throw new Error('压缩包里没找到 3D 模型文件（3dmodel.model）');

  const xml = new TextDecoder('utf-8', { fatal: false }).decode(model.data);
  const w = new VertexWelder();
  const idx: number[] = [];

  // 顶点：<vertex x=".." y=".." z=".."/>
  const vertRe = /<vertex\b[^>]*\bx\s*=\s*"([^"]+)"[^>]*\by\s*=\s*"([^"]+)"[^>]*\bz\s*=\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = vertRe.exec(xml))) {
    w.add(Number(m[1]) || 0, Number(m[2]) || 0, Number(m[3]) || 0);
  }

  // 三角面：<triangle v1="0" v2="1" v3="2"/>
  const triRe = /<triangle\b[^>]*\bv1\s*=\s*"(\d+)"[^>]*\bv2\s*=\s*"(\d+)"[^>]*\bv3\s*=\s*"(\d+)"/g;
  while ((m = triRe.exec(xml))) {
    idx.push(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  if (!idx.length) throw new Error('3MF 里没读到三角面');
  return w.build(idx);
}

// ---------------------------------------------------------------- 入口

/**
 * 解析网格文件（STL / OBJ / PLY / 3MF）。
 * 3MF 是压缩包要解压，所以整体是异步的。
 */
export async function parseMeshFile(
  ext: string,
  buf: ArrayBuffer,
  name?: string,
): Promise<ParseResult> {
  try {
    let mesh: MeshData;
    switch (ext) {
      case 'stl':
        mesh = parseStl(buf);
        break;
      case 'obj':
        mesh = parseObj(buf);
        break;
      case 'ply':
        mesh = parsePly(buf);
        break;
      case '3mf':
        mesh = await parse3mf(buf);
        break;
      default:
        return { ok: false, error: `暂不支持解析 .${ext} 格式` };
    }
    mesh.name = name;
    const tris = mesh.indices ? mesh.indices.length / 3 : mesh.positions.length / 3;
    if (!tris || tris < 1) return { ok: false, error: '文件里没有可用的三角面' };
    return { ok: true, mesh, format: ext as any };
  } catch (e: any) {
    return { ok: false, error: e?.message || '解析失败' };
  }
}
