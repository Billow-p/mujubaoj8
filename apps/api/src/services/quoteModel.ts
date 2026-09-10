// 把报价单版本转成 Excel 视图模型（兼容新旧两种数据结构）

import type { ExcelQuoteModel, ExcelLine } from './excel.js';

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

  // ---- 新结构：配置驱动 ----
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

    const project = Object.entries(vals)
      .map(([k, v]) => {
        const item = (params.parameters ?? []).find((p: any) => p.name === k);
        const label = labelMap[k] ?? k;
        const unit = item?.unit ? ` ${item.unit}` : '';
        return { label, value: `${v}${unit}` };
      })
      .slice(0, 8);

    if (params.productName) project.unshift({ label: '产品名称', value: String(params.productName) });

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
      summary: {
        mold: Number(calc.mold) || 0,
        injection: Number(calc.injection) || 0,
        profitRate: Number(calc.profitRate) || 0,
        profit: Number(calc.profit) || 0,
        taxRate: Number(calc.taxRate) || 0,
        tax: Number(calc.tax) || 0,
        total: Number(calc.total) || 0,
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
