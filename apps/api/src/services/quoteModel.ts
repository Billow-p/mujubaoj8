// 把报价单版本转成 Excel 视图模型（兼容新旧两种数据结构）

import type { ExcelQuoteModel, ExcelLine, ExcelPieceImage } from './excel.js';

/**
 * 件图 —— 从报价快照里挑出挂图的那几件，配一句人能看懂的说明。
 *
 * 说明文字用「模具 1 · 模芯 500×400×150 · 2 穴」这种口径，
 * 客户拿到报价单不用回头翻参数表就知道这图对的是哪件。
 */
function pickPieces(list: any[], kind: 'mold' | 'part', resultList?: any[]): ExcelPieceImage[] {
  const out: ExcelPieceImage[] = [];
  (list ?? []).forEach((it: any, i: number) => {
    // 图可能挂在「入参这一层」，也可能被挪进 calc 结果那一层 —— 两边都找一遍。
    // 早期只认 it.image，result 里放图的报价单导出时就是没图。
    const url = it?.image?.url ?? resultList?.[i]?.image?.url;
    if (!url) return;
    const p = (it?.params ?? {}) as Record<string, any>;
    const bits: string[] = [];
    if (kind === 'mold') {
      const l = p['模芯长'];
      const w = p['模芯宽'];
      const h = p['模芯高'];
      if (l && w && h) bits.push(`模芯 ${l}×${w}×${h}`);
      if (p['腔数']) bits.push(`${p['腔数']} 穴`);
      const steel = p['前模钢材'] || p['钢材单价'];
      if (steel) bits.push(String(steel));
    } else {
      if (p['单件重量']) bits.push(`单件 ${p['单件重量']} kg`);
      if (it?.qty) bits.push(`${it.qty} 件`);
      if (p['原料单价']) bits.push(`料价 ${p['原料单价']} 元/kg`);
    }
    out.push({
      label: it?.name || `${kind === 'mold' ? '模具' : '注塑件'} ${i + 1}`,
      imageUrl: String(url),
      caption: bits.join(' · '),
    });
  });
  return out;
}

/**
 * 兜底：参数里没有 molds/parts 数组时（配置驱动单实例、老结构），
 * 从 features / 顶层 image 字段捞一张图出来，别让用户白传。
 *
 * 一个报价单只有一个「整单件图」的时候，就放在第一段费用下面。
 */
function pickSinglePiece(params: any, calc: any): ExcelPieceImage | null {
  const candidates = [
    params?.image,
    calc?.image,
    params?.pieceImage,
    calc?.pieceImage,
    ...(Array.isArray(calc?.images) ? calc.images : []),
  ];
  for (const c of candidates) {
    const url = typeof c === 'string' ? c : c?.url;
    if (!url) continue;
    const name =
      params?.productName || params?.moldName || calc?.productName || calc?.moldName || '本单件图';
    const bits: string[] = [];
    const v = params?.values ?? {};
    if (v.singleWeightKg) bits.push(`单件 ${v.singleWeightKg} kg`);
    else if (params?.singleWeightKg) bits.push(`单件 ${params.singleWeightKg} kg`);
    return { label: String(name), imageUrl: String(url), caption: bits.join(' · ') };
  }
  return null;
}

/**
 * 没有 molds / parts 数组的「单实例」结构（配置驱动、老 11 项），
 * 整单最多只有一张件图（产品图 / 3D 渲染图）。
 *
 * 有图时挂在「注塑件」段下面 —— 这两类报价通常是注塑件场景。
 * 两个分支原本各写了一遍一模一样的逻辑，抽出来避免以后只改一处。
 */
function singleInstancePieces(params: any, calc: any): {
  moldPieces: ExcelPieceImage[];
  partPieces: ExcelPieceImage[];
} {
  const single = pickSinglePiece(params, calc);
  return { moldPieces: [], partPieces: single ? [single] : [] };
}

const MOLD_FEE_LABELS: Record<string, string> = {
  coreSteel: '模芯钢料费',
  designFee: '模具设计费',
  moldBase: '模架费',
  standardParts: '标准件',
  cncMachining: 'CNC 加工',
  edm: 'EDM 电火花',
  wireCutting: '线切割',
  polishing: '省模抛光',
  trialMold: '试模费',
  surfaceTreatment: '表面处理',
  packagingShipping: '模具包装运输',
};

const INJECTION_LABELS: Record<string, string> = {
  material: '材料费',
  machining: '注塑加工费',
  postProcess: '后加工费',
  packaging: '包装费',
  moldAmortization: '模具分摊',
};

/** 取配置计算结果的明细行（新结构） */
function takeLines(lines: any[], scope: 'mold' | 'injection'): ExcelLine[] {
  return (lines ?? [])
    .filter((l) => l.scope === scope && !l.skipped)
    .map((l) => ({
      name: l.name,
      readable: l.readable,
      value: Number(l.value) || 0,
      unitPrice: l.unitPrice != null ? Number(l.unitPrice) : undefined,
      qty: l.qty != null ? Number(l.qty) : undefined,
      perUnit: l.perUnit === true,
    }));
}

export interface QuoteLike {
  quoteNo: string;
  createdAt: Date;
  expiresAt?: Date | null;
  customer?: { name?: string | null; contactName?: string | null; phone?: string | null; email?: string | null; address?: string | null } | null;
  createdBy?: { name?: string | null } | null;
}

export interface VersionLike {
  paramsJson: any;
  calcResultJson: any;
  businessTermsJson?: any;
}

export function toExcelModel(quote: QuoteLike, version: VersionLike, moldTypeName?: string): ExcelQuoteModel {
  const params = (version.paramsJson ?? {}) as any;
  const calc = (version.calcResultJson ?? {}) as any;

  const customer = {
    name: quote.customer?.name || params.customerName || '—',
    contact: quote.customer?.contactName ?? null,
    phone: quote.customer?.phone ?? null,
    email: quote.customer?.email ?? params.customerEmail ?? null,
    address: quote.customer?.address ?? null,
  };

  // ---- 多注塑件报价（报价项目） ----
  if (calc.kind === 'project') {
    const moldResults: any[] = calc.moldResults ?? [];
    const partResults: any[] = calc.partResults ?? [];

    const moldLines: ExcelLine[] = moldResults.flatMap((m: any) =>
      (m.lines ?? [])
        .filter((l: any) => !l.skipped)
        .map((l: any) => ({
          name: `${m.name} · ${l.name}`,
          readable: l.readable,
          value: Number(l.value) || 0,
          unitPrice: l.unitPrice != null ? Number(l.unitPrice) : undefined,
          qty: l.qty != null ? Number(l.qty) : undefined,
          perUnit: l.perUnit === true,
        })),
    );

    const injectionLines: ExcelLine[] = partResults.flatMap((p: any) =>
      (p.lines ?? [])
        .filter((l: any) => !l.skipped)
        .map((l: any) => ({
          name: `${p.name} · ${l.name}`,
          readable: l.readable,
          value: Number(l.value) || 0,
          unitPrice: l.unitPrice != null ? Number(l.unitPrice) : undefined,
          qty: l.qty != null ? Number(l.qty) : undefined,
          perUnit: l.perUnit === true,
        })),
    );

    const project: { label: string; value: string }[] = [];
    if (params.productName) project.push({ label: '产品名称', value: String(params.productName) });
    if (params.moldTypeName) project.push({ label: '模具类型', value: String(params.moldTypeName) });
    moldResults.forEach((m: any) =>
      project.push({ label: `模具：${m.name}`, value: `¥${(Number(m.subtotal) || 0).toLocaleString('zh-CN')}` }),
    );
    partResults.forEach((p: any) =>
      project.push({
        label: `注塑件：${p.name} ×${Number(p.qty) || 0} 件`,
        value: `¥${(Number(p.total) || 0).toLocaleString('zh-CN')}`,
      }),
    );

    return {
      company: params.company,
      quoteNo: quote.quoteNo,
      createdAt: quote.createdAt,
      expiresAt: quote.expiresAt ?? null,
      moldTypeName: moldTypeName ?? params.moldTypeName,
      customer,
      project: project.length ? project : [{ label: '产品', value: '—' }],
      moldLines,
      injectionLines,
      moldPieces: pickPieces(params.molds, 'mold', calc.moldResults),
      partPieces: pickPieces(params.parts, 'part', calc.partResults),
      summary: {
        mold: Number(calc.moldSubtotal) || 0,
        injection: Number(calc.injectionSubtotal) || 0,
        profitRate: Number(calc.profitRate) || 0,
        profit: Number(calc.profit) || 0,
        taxRate: Number(calc.taxRate) || 0,
        tax: Number(calc.tax) || 0,
        total: Number(calc.total) || 0,
        injectionQty: undefined,
        unitCost: undefined,
      },
      terms: (version.businessTermsJson ?? [])
        .filter((t: any) => t?.enabled !== false)
        .map((t: any) => (typeof t === 'string' ? t : t.text)),
      senderName: quote.createdBy?.name ?? undefined,
    };
  }

  // ---- 新结构：配置驱动（单实例） ----
  if (Array.isArray(calc.lines)) {
    const moldLines = takeLines(calc.lines, 'mold');
    const injectionLines = takeLines(calc.lines, 'injection');
    const vals = params.values ?? {}; // 参数名 → 值

    const labelMap: Record<string, string> = {
      productName: '产品名称',
      cavityCount: '腔数',
      singleWeightKg: '单件重量',
      coreLengthMm: '模芯长',
      coreWidthMm: '模芯宽',
      coreHeightMm: '模芯高',
      projectionArea: '投影面积',
      wallThickness: '平均壁厚',
      firstOrderQty: '首单数量',
      material: '产品材质',
      steel: '模具钢材',
    };

    // 顺序必须按 parameters 数组来 —— values 存在 jsonb 字段里，
    // jsonb 会按「键长度 + 字节序」重排对象键，中文参数名的顺序会被打乱。
    const paramDefs = (params.parameters ?? []) as any[];
    const orderedVals: [string, any][] = [];
    const seenKeys = new Set<string>();
    for (const p of paramDefs) {
      if (vals[p.name] !== undefined) {
        orderedVals.push([p.name, vals[p.name]]);
        seenKeys.add(p.name);
      }
    }
    for (const [k, v] of Object.entries(vals)) {
      if (!seenKeys.has(k)) orderedVals.push([k, v]);
    }

    const project = orderedVals
      .map(([k, v]) => {
        const label = labelMap[k] ?? k;
        const def = paramDefs.find((p) => p.name === k) as any;

        // 下拉型参数显示选项文字，而不是内部的 0 / 1
        if (def?.type === 'select' && Array.isArray(def.options)) {
          const hit = def.options.find((o: any) => Number(o.value) === Number(v));
          if (hit) return { label, value: String(hit.label) };
        }

        const unit = def?.unit;
        return { label, value: unit ? `${v} ${unit}` : `${v}` };
      })
      // 参数多的类型（注塑有 10 多个）别把「注塑数量」这类关键参数截掉
      .slice(0, 18);

    if (params.productName) project.unshift({ label: '产品名称', value: String(params.productName) });

    // 配置驱动单实例：没有 molds/parts 数组，整单只可能有一张件图（产品图/3D 渲染图）
    const { moldPieces, partPieces } = singleInstancePieces(params, calc);

    return {
      company: params.company,
      quoteNo: quote.quoteNo,
      createdAt: quote.createdAt,
      expiresAt: quote.expiresAt ?? null,
      moldTypeName: moldTypeName ?? params.moldTypeName,
      customer,
      project: project.length ? project : [{ label: '产品', value: '—' }],
      moldLines,
      injectionLines,
      moldPieces,
      partPieces,
      summary: {
        mold: Number(calc.mold) || 0,
        injection: Number(calc.injection) || 0,
        profitRate: Number(calc.profitRate) || 0,
        profit: Number(calc.profit) || 0,
        taxRate: Number(calc.taxRate) || 0,
        tax: Number(calc.tax) || 0,
        total: Number(calc.total) || 0,
        injectionQty: Number(calc.injectionQty) || undefined,
        unitCost: Number(calc.unitCost) || undefined,
      },
      terms: (version.businessTermsJson ?? [])
        .filter((t: any) => t?.enabled !== false)
        .map((t: any) => (typeof t === 'string' ? t : t.text)),
      senderName: quote.createdBy?.name ?? undefined,
    };
  }

  // ---- 老结构：11 项模具费模型 ----
  const moldItems = calc.moldFeeItems ?? {};
  const injItems = calc.injectionItems ?? {};
  const sum = calc.summary ?? {};

  const moldLines: ExcelLine[] = Object.entries(moldItems).map(([k, v]: any) => ({
    name: MOLD_FEE_LABELS[k] ?? k,
    readable: v?.formula,
    value: Number(v?.value) || 0,
  }));

  const qty = Number(params.firstOrderQty) || 0;
  const injectionLines: ExcelLine[] = Object.entries(injItems).map(([k, v]: any) => ({
    name: INJECTION_LABELS[k] ?? k,
    readable: v?.formula
      ? `${v.formula}${qty ? `　×　${qty.toLocaleString('zh-CN')} 件` : ''}`
      : undefined,
    value: (Number(v?.value) || 0) * (k === 'moldAmortization' ? 1 : qty || 1),
  }));

  const project: { label: string; value: string }[] = [];
  if (params.productName) project.push({ label: '产品名称', value: String(params.productName) });
  if (params.material) project.push({ label: '产品材质', value: String(params.material) });
  if (params.steel) project.push({ label: '模具钢材', value: String(params.steel) });
  if (params.cavityCount) project.push({ label: '腔数', value: `${params.cavityCount} 穴` });
  if (qty) project.push({ label: '首单数量', value: `${qty.toLocaleString('zh-CN')} 件` });
  if (params.singleWeightKg) project.push({ label: '单件重量', value: `${params.singleWeightKg} kg` });

  // 老结构（11 项模具费）：同样补上整单件图兜底，别让用户上传的图在导出时凭空消失
  const { moldPieces, partPieces } = singleInstancePieces(params, calc);

  return {
    company: params.company,
    quoteNo: quote.quoteNo,
    createdAt: quote.createdAt,
    expiresAt: quote.expiresAt ?? null,
    moldTypeName: moldTypeName ?? params.moldTypeName ?? '注塑模具',
    customer,
    project,
    moldLines,
    injectionLines,
    moldPieces,
    partPieces,
    summary: {
      mold: Number(sum.moldIncVat) || 0,
      injection: Number(sum.injectionIncVat) || 0,
      profitRate: Number(params.managementRate) || 0,
      profit: Number(sum.moldManagementFee) || 0,
      taxRate: Number(params.vatRate) || 0,
      tax: Number(sum.grandTotalVat) || 0,
      total: Number(sum.grandTotalIncVat) || 0,
    },
    terms: (version.businessTermsJson ?? [])
      .filter((t: any) => t?.enabled !== false)
      .map((t: any) => (typeof t === 'string' ? t : t.text)),
    senderName: quote.createdBy?.name ?? undefined,
  };
}
