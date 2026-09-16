/**
 * 3D 图纸解析的统一入口。
 *
 * 调用方只需要给一个 File，这里负责：认格式 → 解析 → 换算单位 → 算几何量 →
 * 给「这是模具还是注塑件」的建议 + 建议填哪些参数。
 *
 * 重要：所有建议都带置信度，界面上必须让用户确认后才落参数 —— 归类错了直接就报错价。
 */

import { parseMeshFile } from './meshFormats';
import { parseWithOcct } from './occt';
import { summarize, scaleMesh, guessUnitScale } from './summary';
import type { GeometrySummary, MeshData, ParseResult } from './types';
import { extOf, formatSupport } from './types';

export * from './types';
export { summarize, guessUnitScale } from './summary';

/** 文件解析后的完整结果 */
export interface Parsed3D {
  fileName: string;
  format: string;
  mesh: MeshData;
  summary: GeometrySummary;
  /** 单位建议（文件没写单位时猜的） */
  unit: { unit: string; scale: number; reason: string };
  /** 归类建议：模具还是注塑件 */
  classify: ClassifyResult;
  /** 建议回填的参数（键是参数名，值是建议数字） */
  suggestedParams: SuggestedParam[];
  /** 需要提醒用户的话（体积不可信、单位不确定等） */
  warnings: string[];
}

export type ItemKind = 'mold' | 'part';

export interface ClassifyResult {
  kind: ItemKind;
  /** 0~1，低于 0.6 就一定要让用户手动确认 */
  confidence: number;
  reason: string;
}

export interface SuggestedParam {
  /** 参数名，要和报价参数表里的名字对上 */
  name: string;
  value: number;
  unit: string;
  /** 这句会显示在界面上，让用户知道数是怎么来的 */
  note: string;
}

/** 面数太多就不渲染预览了，卡 */
export const PREVIEW_MAX_TRIS = 400_000;

/**
 * 判断是模具还是注塑件。
 *
 * 判据是「体积 / 表面积」这个比值：
 * - 注塑件是薄壁壳，同样表面积下体积小 → 比值小
 * - 模具是实心钢块 → 比值大
 * 再叠加尺寸量级做修正。纯几何判断有出错可能，所以一律带置信度。
 */
export function classify(summary: GeometrySummary): ClassifyResult {
  const [x, y, z] = summary.bbox.size;
  const longest = Math.max(x, y, z);
  // V/A：立方体边长 a → a/6；薄板厚度 t → t/2
  const ratio = summary.surfaceAreaMm2 > 0 ? summary.volumeMm3 / summary.surfaceAreaMm2 : 0;

  if (ratio <= 0 || longest <= 0) {
    return { kind: 'part', confidence: 0.3, reason: '几何量异常，建议手动选择' };
  }

  // 薄壁特征明显 → 注塑件
  if (ratio < 1.5) {
    return {
      kind: 'part',
      confidence: 0.8,
      reason: `壁厚特征 ${ratio.toFixed(2)}（<1.5 属薄壁壳体），判定为注塑件`,
    };
  }
  // 厚实块体 → 模具
  if (ratio > 4) {
    return {
      kind: 'mold',
      confidence: 0.75,
      reason: `壁厚特征 ${ratio.toFixed(2)}（>4 属实心块体），判定为模具`,
    };
  }
  // 中间地带：看尺寸。模具体量通常大得多
  if (longest > 150) {
    return {
      kind: 'mold',
      confidence: 0.5,
      reason: `壁厚特征 ${ratio.toFixed(2)} 不明显，但最长边 ${Math.round(longest)}mm 偏大，倾向模具`,
    };
  }
  return {
    kind: 'part',
    confidence: 0.45,
    reason: `壁厚特征 ${ratio.toFixed(2)} 介于两者之间，最长边 ${Math.round(longest)}mm，倾向注塑件（请确认）`,
  };
}

/** 模芯尺寸 = 产品包围盒 + 每边留的钢料（默认单边 40mm） */
const STEEL_MARGIN_PER_SIDE = 40;

/**
 * 由几何量推出建议参数。
 * @param kind 归类结果（决定填模具参数还是注塑件参数）
 * @param density 材料密度 g/cm³（注塑件用塑料密度、模具用钢材密度）
 */
export function suggestParams(
  summary: GeometrySummary,
  kind: ItemKind,
  density: number,
): SuggestedParam[] {
  const [x, y, z] = summary.bbox.size;
  const sorted = [...summary.bbox.size].sort((a, b) => b - a);
  const volumeCm3 = summary.volumeMm3 / 1000;
  const weightKg = (volumeCm3 * density) / 1000;

  if (kind === 'mold') {
    return [
      {
        name: '模芯长',
        value: Math.round(sorted[0] + STEEL_MARGIN_PER_SIDE * 2),
        unit: 'mm',
        note: `模型长 ${Math.round(sorted[0])}mm + 单边 ${STEEL_MARGIN_PER_SIDE}mm 钢料`,
      },
      {
        name: '模芯宽',
        value: Math.round(sorted[1] + STEEL_MARGIN_PER_SIDE * 2),
        unit: 'mm',
        note: `模型宽 ${Math.round(sorted[1])}mm + 单边 ${STEEL_MARGIN_PER_SIDE}mm 钢料`,
      },
      {
        name: '模芯高',
        value: Math.round(sorted[2] + STEEL_MARGIN_PER_SIDE * 2),
        unit: 'mm',
        note: `模型高 ${Math.round(sorted[2])}mm + 单边 ${STEEL_MARGIN_PER_SIDE}mm 钢料`,
      },
      {
        name: '模具重量',
        value: Number(weightKg.toFixed(2)),
        unit: 'kg',
        note: `体积 ${volumeCm3.toFixed(0)}cm³ × 密度 ${density}g/cm³`,
      },
    ];
  }

  return [
    {
      name: '单件重量',
      value: Number(weightKg.toFixed(4)),
      unit: 'kg',
      note: `体积 ${volumeCm3.toFixed(2)}cm³ × 密度 ${density}g/cm³`,
    },
    {
      name: '投影面积',
      value: Number(((x * y) / 100).toFixed(2)),
      unit: 'cm²',
      note: `按底面 ${Math.round(x)}×${Math.round(y)}mm 估算（用于估锁模力）`,
    },
  ];
}

/**
 * 解析一个 3D 文件。
 * @param density 用于算重量的密度（g/cm³），默认钢材 7.85
 */
export async function parse3DFile(
  file: File | { name: string; buffer: ArrayBuffer },
  density = 7.85,
): Promise<{ ok: true; data: Parsed3D } | { ok: false; error: string; hint?: string }> {
  const name = file.name;
  const ext = extOf(name);
  const support = formatSupport(ext);

  if (support === 'unknown') {
    return { ok: false, error: `不认识 .${ext} 文件`, hint: '目前支持 STEP / IGES / BREP / STL / OBJ / PLY / 3MF' };
  }
  if (support === 'vendor') {
    return {
      ok: false,
      error: `.${ext} 是 ${vendorName(ext)} 的专有格式，读不出几何数据`,
      hint: '请在原软件里「另存为 / 导出」成 STEP(.step) 或 STL，再传上来 —— 这样能算出准确体积和重量',
    };
  }

  const buffer = 'buffer' in file ? file.buffer : await file.arrayBuffer();
  if (!buffer.byteLength) return { ok: false, error: '文件是空的' };

  // 注意：OCCT 会把 buffer 转移走，所以先留一份字节数用于提示
  const sizeKb = buffer.byteLength / 1024;

  let r: ParseResult;
  if (support === 'occt') {
    // buffer 会被 transfer，传副本更安全（避免调用方的 buffer 被清空）
    r = await parseWithOcct(ext, buffer.slice(0), name);
  } else {
    r = await parseMeshFile(ext, buffer, name);
  }
  if (!r.ok) {
    return {
      ok: false,
      error: r.error,
      hint: support === 'occt' ? '如果确认是有效 STEP/IGES，可尝试在建模软件里导出 STL 再传' : undefined,
    };
  }

  // 单位：OCCT 已按 mm 输出；网格文件没写单位，按尺寸猜
  let mesh = r.mesh;
  let unit = { unit: 'mm', scale: 1, reason: 'CAD 内核已按毫米输出' };
  if (support === 'self') {
    const raw = summarize(mesh);
    unit = guessUnitScale(raw.bbox.size);
    if (unit.scale !== 1) mesh = scaleMesh(mesh, unit.scale);
  }

  const summary = summarize(mesh);
  const warnings: string[] = [];
  if (!summary.closed) {
    warnings.push('模型不是封闭实体（有破面或缺面），体积和重量是估算值，建议核对');
  }
  if (unit.scale !== 1) {
    warnings.push(`文件没写单位，按${unit.unit}处理（${unit.reason}）`);
  }
  if (sizeKb > 50 * 1024) {
    warnings.push(`文件 ${(sizeKb / 1024).toFixed(1)}MB，解析会慢一些`);
  }

  const cls = classify(summary);
  return {
    ok: true,
    data: {
      fileName: name,
      format: ext,
      mesh,
      summary,
      unit,
      classify: cls,
      suggestedParams: suggestParams(summary, cls.kind, density),
      warnings,
    },
  };
}

function vendorName(ext: string): string {
  const map: Record<string, string> = {
    sldprt: 'SolidWorks', sldasm: 'SolidWorks',
    prt: 'Pro/E 或 Creo', asm: 'Pro/E 或 Creo', 'prt.1': 'Pro/E 或 Creo',
    ipt: 'Inventor', iam: 'Inventor',
    catpart: 'CATIA', catproduct: 'CATIA',
    x_t: 'Parasolid', x_b: 'Parasolid', sat: 'ACIS',
    '3dxml': 'CATIA', jt: 'Siemens', fbx: '通用交换', dae: '通用交换', skp: 'SketchUp',
  };
  return map[ext] || '该软件';
}
