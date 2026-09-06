// 模具注塑报价系统 — 计算引擎
// 纯函数，无副作用，前后端共用

import type {
  CalcItem,
  CalcQuoteRequest,
  InjectionItems,
  MoldFeeItems,
  QuoteCalcResult,
  QuoteInput,
  QuoteSummary,
  BusinessTermItem,
} from '../../shared/src/index.ts';
import { DEFAULT_BUSINESS_TERMS } from '../../shared/src/index.ts';
import {
  COMPLEXITY_COEFF,
  STEEL_COEFF,
  MATERIAL_UNIT_PRICE,
  STEEL_UNIT_PRICE,
  HOURLY_RATE,
  BASE_HOURS,
  MOLD_BASE_PRICE_TABLE,
  STANDARD_PARTS_PER_CAVITY,
  TRIAL_MOLD_BASE,
  SURFACE_TREATMENT_PER_CAVITY,
  PROVINCE_INNER_SHIPPING,
  POST_PROCESS_UNIT_PRICE,
  DEFAULT_PACKAGING_FEE,
} from './tables.ts';

const round = (n: number): number => Math.round(n * 100) / 100;
const yuan = (n: number): number => Math.round(n);

// ============================================================
// 模架价格查表
// ============================================================
function lookupMoldBasePrice(lengthMm: number, widthMm: number): number {
  const area = lengthMm * widthMm;
  for (const row of MOLD_BASE_PRICE_TABLE) {
    if (area <= row.maxArea) return row.price;
  }
  return MOLD_BASE_PRICE_TABLE[MOLD_BASE_PRICE_TABLE.length - 1].price;
}

// ============================================================
// 11 项模具费
// ============================================================
function calcMoldFeeItems(input: QuoteInput): {
  items: MoldFeeItems;
  provenance: { complexityCoeff: number; steelCoeff: number; materialUnitPrice: number };
} {
  const complexityCoeff = COMPLEXITY_COEFF[input.complexity];
  const steelCoeff = STEEL_COEFF[input.steel];
  const materialUnitPrice = MATERIAL_UNIT_PRICE[input.material];

  // 1. 模芯钢料费 — 纯公式（不允许手动覆盖）
  const coreSteelVolumeCm3 =
    (input.coreLengthMm * input.coreWidthMm * input.coreHeightMm) / 1000;
  const coreSteelWeightKg = (coreSteelVolumeCm3 * input.steelDensity) / 1000;
  const coreSteelValue = yuan(coreSteelWeightKg * input.steelUnitPrice);

  // 2. 模具设计费 — 6000 × 复杂度 × 钢材
  const designFeeValue = yuan(6000 * complexityCoeff * steelCoeff);

  // 3. 模架费 — 查表
  const moldBaseValue = lookupMoldBasePrice(input.coreLengthMm, input.coreWidthMm);

  // 4. 标准件 — 每腔单价 × 腔数
  const standardPartsValue = yuan(STANDARD_PARTS_PER_CAVITY * input.cavityCount);

  // 5. CNC 加工 — 工时 × 费率 × 复杂度 × 钢材
  const cncHours = BASE_HOURS.CNC * (1 + 0.2 * Math.log2(Math.max(1, input.cavityCount)));
  const cncMachiningValue = yuan(cncHours * HOURLY_RATE.CNC * complexityCoeff * steelCoeff);

  // 6. EDM 电火花 — 工时 × 费率 × 复杂度 × 钢材
  const edmHours = BASE_HOURS.EDM * (1 + 0.1 * (input.cavityCount - 1));
  const edmValue = yuan(edmHours * HOURLY_RATE.EDM * complexityCoeff * steelCoeff);

  // 7. 线切割 — 镶件数（≈ 腔数） × 单价 × 钢材系数
  const wireCuttingValue = yuan(
    BASE_HOURS.wireCutting * HOURLY_RATE.wireCutting * input.cavityCount * steelCoeff,
  );

  // 8. 省模抛光 — 工时 × 费率
  const polishingValue = yuan(
    BASE_HOURS.polishing * HOURLY_RATE.polishing * complexityCoeff,
  );

  // 9. 试模费 — 基础价 + 次数 × 成本
  const trialMoldValue = yuan(
    TRIAL_MOLD_BASE + BASE_HOURS.trialMold * HOURLY_RATE.trialMold,
  );

  // 10. 表面处理 — 每腔单价 × 腔数 × 复杂度
  const surfaceTreatmentValue = yuan(
    SURFACE_TREATMENT_PER_CAVITY * input.cavityCount * complexityCoeff,
  );

  // 11. 模具包装运输 — 省内 3000
  const packagingShippingValue = PROVINCE_INNER_SHIPPING;

  const items: MoldFeeItems = {
    coreSteel: {
      value: coreSteelValue,
      formula: `${input.coreLengthMm}×${input.coreWidthMm}×${input.coreHeightMm}/1000×${input.steelDensity}×${input.steelUnitPrice}/1000`,
      locked: false,
      overridden: false,
    },
    designFee: {
      value: designFeeValue,
      formula: `6000 × ${complexityCoeff}(复杂度) × ${steelCoeff}(钢材)`,
      locked: false,
      overridden: false,
    },
    moldBase: {
      value: moldBaseValue,
      formula: `按 ${input.coreLengthMm}×${input.coreWidthMm} 查《模架价格表》`,
      locked: false,
      overridden: false,
    },
    standardParts: {
      value: standardPartsValue,
      formula: `${STANDARD_PARTS_PER_CAVITY}/穴 × ${input.cavityCount}腔`,
      locked: false,
      overridden: false,
    },
    cncMachining: {
      value: cncMachiningValue,
      formula: `${cncHours.toFixed(1)}h × ${HOURLY_RATE.CNC}/h × ${complexityCoeff} × ${steelCoeff}`,
      locked: false,
      overridden: false,
    },
    edm: {
      value: edmValue,
      formula: `${edmHours.toFixed(1)}h × ${HOURLY_RATE.EDM}/h × ${complexityCoeff} × ${steelCoeff}`,
      locked: false,
      overridden: false,
    },
    wireCutting: {
      value: wireCuttingValue,
      formula: `${BASE_HOURS.wireCutting} × ${HOURLY_RATE.wireCutting} × ${input.cavityCount}腔 × ${steelCoeff}`,
      locked: false,
      overridden: false,
    },
    polishing: {
      value: polishingValue,
      formula: `${BASE_HOURS.polishing}h × ${HOURLY_RATE.polishing}/h × ${complexityCoeff}`,
      locked: false,
      overridden: false,
    },
    trialMold: {
      value: trialMoldValue,
      formula: `${TRIAL_MOLD_BASE}(基础) + ${BASE_HOURS.trialMold}次 × ${HOURLY_RATE.trialMold}`,
      locked: false,
      overridden: false,
    },
    surfaceTreatment: {
      value: surfaceTreatmentValue,
      formula: `${SURFACE_TREATMENT_PER_CAVITY}/穴 × ${input.cavityCount}腔 × ${complexityCoeff}`,
      locked: false,
      overridden: false,
    },
    packagingShipping: {
      value: packagingShippingValue,
      formula: '广东省内 3000',
      locked: false,
      overridden: false,
    },
  };

  return {
    items,
    provenance: { complexityCoeff, steelCoeff, materialUnitPrice },
  };
}

// ============================================================
// 5 项注塑单件成本
// ============================================================
function calcInjectionItems(
  input: QuoteInput,
  moldTotalExVat: number,
): InjectionItems {
  // 1. 材料费 — 单件重量 × 材料单价 × (1 + 损耗率)
  const materialUnitPrice = MATERIAL_UNIT_PRICE[input.material];
  const materialValue = round(
    input.singleWeightKg * materialUnitPrice * (1 + input.materialLossRate),
  );

  // 2. 注塑加工费 — 机台小时费率 ÷ ((3600/周期) × 腔数 × 效率)
  const cyclesPerHour = 3600 / input.cycleTimeS;
  const unitsPerHour = cyclesPerHour * input.cavityCount * input.efficiencyFactor;
  const machiningValue = round(input.machineRatePerHour / unitsPerHour);

  // 3. 后加工费 — 查表
  const postProcessValue = round(
    POST_PROCESS_UNIT_PRICE[input.postProcessType] ?? 0.15,
  );

  // 4. 包装费 — 默认 0.10
  const packagingValue = DEFAULT_PACKAGING_FEE;

  // 5. 模具分摊 — 模具合计 ÷ 首单数量
  const moldAmortizationValue = round(moldTotalExVat / input.firstOrderQty);

  const items: InjectionItems = {
    material: {
      value: materialValue,
      formula: `${input.singleWeightKg} × ${materialUnitPrice} × (1 + ${input.materialLossRate})`,
      locked: false,
      overridden: false,
    },
    machining: {
      value: machiningValue,
      formula: `${input.machineRatePerHour} / ((3600/${input.cycleTimeS}) × ${input.cavityCount} × ${input.efficiencyFactor})`,
      locked: false,
      overridden: false,
    },
    postProcess: {
      value: postProcessValue,
      formula: `后加工类型「${input.postProcessType}」查表`,
      locked: false,
      overridden: false,
    },
    packaging: {
      value: packagingValue,
      formula: `默认 ${DEFAULT_PACKAGING_FEE} 元/件`,
      locked: false,
      overridden: false,
    },
    moldAmortization: {
      value: moldAmortizationValue,
      formula: `${moldTotalExVat.toFixed(2)} / ${input.firstOrderQty}`,
      locked: false,
      overridden: false,
    },
  };

  return items;
}

// ============================================================
// 模具费小计（仅依赖模具费明细）
// ============================================================
function calcMoldSubtotal(moldItems: MoldFeeItems): number {
  return Math.round(
    moldItems.coreSteel.value +
      moldItems.designFee.value +
      moldItems.moldBase.value +
      moldItems.standardParts.value +
      moldItems.cncMachining.value +
      moldItems.edm.value +
      moldItems.wireCutting.value +
      moldItems.polishing.value +
      moldItems.trialMold.value +
      moldItems.surfaceTreatment.value +
      moldItems.packagingShipping.value,
  );
}

// ============================================================
// 汇总（完整）
// ============================================================
function calcSummary(
  moldItems: MoldFeeItems,
  injectionItems: InjectionItems,
  input: QuoteInput,
): QuoteSummary {
  const moldSubtotal = calcMoldSubtotal(moldItems);
  const moldManagementFee = Math.round(moldSubtotal * input.managementRate);
  const moldTotalExVat = moldSubtotal + moldManagementFee;

  const unitCostExVat = round(
    injectionItems.material.value +
      injectionItems.machining.value +
      injectionItems.postProcess.value +
      injectionItems.packaging.value +
      injectionItems.moldAmortization.value,
  );

  const injectionTotalExVat = Math.round(unitCostExVat * input.firstOrderQty);
  const grandTotalExVat = moldTotalExVat + injectionTotalExVat;

  const moldVat = Math.round(moldTotalExVat * input.vatRate);
  const injectionVat = Math.round(injectionTotalExVat * input.vatRate);
  const grandTotalVat = moldVat + injectionVat;

  const moldIncVat = moldTotalExVat + moldVat;
  const injectionIncVat = injectionTotalExVat + injectionVat;
  const grandTotalIncVat = grandTotalExVat + grandTotalVat;

  return {
    moldSubtotal,
    moldManagementFee,
    moldTotalExVat,
    moldVat,
    moldIncVat,
    unitCostExVat,
    injectionTotalExVat,
    injectionVat,
    injectionIncVat,
    grandTotalExVat,
    grandTotalVat,
    grandTotalIncVat,
  };
}

// ============================================================
// 主入口
// ============================================================
export function calculateQuote(req: CalcQuoteRequest): QuoteCalcResult {
  const input = req.input;

  // 计算模具费
  const { items: moldFeeItems, provenance } = calcMoldFeeItems(input);

  // 应用 overrides（手动覆盖）
  const locks = new Set(req.locks ?? []);
  if (req.overrides) {
    (Object.keys(req.overrides) as Array<keyof MoldFeeItems>).forEach((k) => {
      const item = moldFeeItems[k] as CalcItem | undefined;
      if (item && req.overrides && req.overrides[k] !== undefined) {
        item.value = req.overrides[k]!;
        item.overridden = true;
        item.locked = locks.has(k);
        item.formula = `【手动覆盖】原值 ${item.value}`;
      }
    });
  }

  // 应用 lock（仅锁，不改值）
  locks.forEach((k) => {
    if (moldFeeItems[k]) {
      moldFeeItems[k].locked = true;
    }
  });

  // 模具费小计（用于注塑的"模具分摊"）
  const moldSubtotal = calcMoldSubtotal(moldFeeItems);
  const moldManagementFee = Math.round(moldSubtotal * input.managementRate);
  const moldTotalExVat = moldSubtotal + moldManagementFee;

  // 计算注塑（依赖模具合计）
  const injectionItems = calcInjectionItems(input, moldTotalExVat);

  // 应用注塑 overrides
  if (req.overrides) {
    (Object.keys(req.overrides) as Array<keyof InjectionItems>).forEach((k) => {
      const item = injectionItems[k] as CalcItem | undefined;
      if (item && req.overrides && req.overrides[k] !== undefined) {
        item.value = req.overrides[k]!;
        item.overridden = true;
        item.locked = locks.has(k);
        item.formula = `【手动覆盖】原值 ${item.value}`;
      }
    });
  }

  locks.forEach((k) => {
    if (injectionItems[k as keyof InjectionItems]) {
      (injectionItems[k as keyof InjectionItems] as CalcItem).locked = true;
    }
  });

  // 重算汇总（注入最终值）
  const summary = calcSummary(moldFeeItems, injectionItems, input);

  // 商务条款
  const businessTerms = applyBusinessTermOverrides(req.businessTermOverrides);

  return {
    moldFeeItems,
    injectionItems,
    summary,
    businessTerms,
    provenance,
  };
}

function applyBusinessTermOverrides(
  overrides?: BusinessTermItem[],
): BusinessTermItem[] {
  if (!overrides || overrides.length === 0) return DEFAULT_BUSINESS_TERMS;
  // 合并：覆盖优先，新增追加
  const map = new Map<number, BusinessTermItem>();
  for (const t of DEFAULT_BUSINESS_TERMS) map.set(t.index, { ...t });
  for (const o of overrides) map.set(o.index, { ...o });
  return Array.from(map.values()).sort((a, b) => a.index - b.index);
}

// ============================================================
// 最优腔数推荐
// ============================================================
export interface CavityComparison {
  cavityCount: number;
  moldTotalExVat: number;
  unitCost: number;
  injectionTotal: number;
  grandTotal: number; // 总成本（模具 + 注塑）
}

export function compareOptimalCavity(
  input: Omit<QuoteInput, 'cavityCount'>,
): CavityComparison[] {
  const candidates = [1, 2, 4, 8];
  return candidates.map((n) => {
    const result = calculateQuote({ input: { ...input, cavityCount: n } });
    return {
      cavityCount: n,
      moldTotalExVat: result.summary.moldTotalExVat,
      unitCost: result.summary.unitCostExVat,
      injectionTotal: result.summary.injectionTotalExVat,
      grandTotal: result.summary.grandTotalExVat,
    };
  });
}

// ============================================================
// 输入参数校验
// ============================================================
export interface ValidationError {
  field: string;
  message: string;
}

export function validateQuoteInput(input: Partial<QuoteInput>): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!input.customerName) errors.push({ field: 'customerName', message: '客户名称必填' });
  if (!input.productName) errors.push({ field: 'productName', message: '产品名称必填' });
  if (!input.material) errors.push({ field: 'material', message: '产品材质必填' });
  if (!input.steel) errors.push({ field: 'steel', message: '模具钢材必填' });
  if (!input.complexity) errors.push({ field: 'complexity', message: '产品复杂度必填' });
  if (input.singleWeightKg === undefined || input.singleWeightKg <= 0)
    errors.push({ field: 'singleWeightKg', message: '单件重量必须 > 0' });
  if (!input.cavityCount || input.cavityCount < 1)
    errors.push({ field: 'cavityCount', message: '腔数必须 ≥ 1' });
  if (!input.cycleTimeS || input.cycleTimeS < 1)
    errors.push({ field: 'cycleTimeS', message: '成型周期必须 > 0' });
  if (!input.firstOrderQty || input.firstOrderQty < 1)
    errors.push({ field: 'firstOrderQty', message: '首单数量必须 ≥ 1' });
  if (input.efficiencyFactor === undefined || input.efficiencyFactor <= 0 || input.efficiencyFactor > 1)
    errors.push({ field: 'efficiencyFactor', message: '效率系数应在 (0, 1]' });
  return errors;
}
