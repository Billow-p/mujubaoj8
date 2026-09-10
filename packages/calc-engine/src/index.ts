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
  CustomFormulaInput,
  CustomFormulaResults,
} from '@mqs/shared';
import { DEFAULT_BUSINESS_TERMS } from '@mqs/shared';
import { evaluateExpression } from './expression.js';

// 表达式求值器对外暴露（供后端公式测试接口复用）
export { evaluateExpression, normalizeExpression } from './expression.js';
export type { Scope } from './expression.js';
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
} from './tables.js';

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
  extras: { moldExtrasTotal: number; injectionExtrasUnit: number },
  custom: { moldCustom: number; injectionCustom: number } = {
    moldCustom: 0,
    injectionCustom: 0,
  },
): QuoteSummary {
  const moldSubtotal =
    calcMoldSubtotal(moldItems) + extras.moldExtrasTotal + custom.moldCustom;
  const moldManagementFee = Math.round(moldSubtotal * input.managementRate);
  const moldTotalExVat = moldSubtotal + moldManagementFee;

  const unitCostExVat = round(
    injectionItems.material.value +
      injectionItems.machining.value +
      injectionItems.postProcess.value +
      injectionItems.packaging.value +
      injectionItems.moldAmortization.value +
      extras.injectionExtrasUnit +
      custom.injectionCustom,
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
    moldExtrasTotal: extras.moldExtrasTotal,
    moldManagementFee,
    moldTotalExVat,
    moldVat,
    moldIncVat,
    unitCostExVat,
    injectionExtrasUnit: extras.injectionExtrasUnit,
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
    const key = k as keyof MoldFeeItems;
    if (moldFeeItems[key]) {
      moldFeeItems[key].locked = true;
    }
  });

  // 模具费小计（用于注塑的"模具分摊"）
  const moldSubtotal = calcMoldSubtotal(moldFeeItems);
  const moldManagementFee = Math.round(moldSubtotal * input.managementRate);
  const moldTotalExVatBase = moldSubtotal + moldManagementFee;

  // 计算注塑（依赖模具合计）
  const injectionItems = calcInjectionItems(input, moldTotalExVatBase);

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

  // 用户自定义附加项
  const extrasIn = input.extras ?? { moldExtras: [], injectionExtras: [] };
  const moldExtras = extrasIn.moldExtras ?? [];
  const injectionExtras = extrasIn.injectionExtras ?? [];
  const moldExtrasTotal = Math.round(
    moldExtras.reduce((s, e) => s + (Number(e.amount) || 0), 0),
  );
  const injectionExtrasUnit = round(
    injectionExtras.reduce((s, e) => s + (Number(e.amount) || 0), 0),
  );

  // 参数中心 — 用户自定义公式求值
  const customResults: CustomFormulaResults = {
    mold: [],
    injection: [],
    summary: [],
  };
  let moldCustom = 0;
  let injectionCustom = 0;
  if (req.customFormulas && req.customFormulas.length > 0) {
    // 按 scope、sortOrder 排序
    const sorted = [...req.customFormulas]
      .filter((f) => f.enabled !== false)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // 构建可用变量名集合
    const inputKeys = Object.keys(input);
    const moldKeys = Object.keys(moldFeeItems);
    const injectionKeys = Object.keys(injectionItems);
    const formulaNames = sorted.map((f) => f.name);
    const formulaCodes = sorted.map((f) => f.code).filter(Boolean) as string[];
    // PRD 4.3：自定义参数也可被公式引用
    const customParamEntries = Object.entries(
      (input as any).customParams ?? {},
    ).filter(([, v]) => typeof v === 'number' || !Number.isNaN(Number(v)));
    const customParamKeys = customParamEntries.map(([k]) => k);

    const allowed = new Set<string>([
      ...inputKeys,
      ...moldKeys,
      ...injectionKeys,
      ...formulaNames,
      ...formulaCodes,
      ...customParamKeys,
    ]);

    // scope：变量值
    const scope: Record<string, number> = {
      ...Object.fromEntries(
        Object.entries(input).filter(([, v]) => typeof v === 'number'),
      ),
      ...Object.fromEntries(
        Object.entries(moldFeeItems).map(([k, v]) => [k, (v as CalcItem).value]),
      ),
      ...Object.fromEntries(
        Object.entries(injectionItems).map(([k, v]) => [k, (v as CalcItem).value]),
      ),
      ...Object.fromEntries(
        customParamEntries.map(([k, v]) => [k, Number(v)]),
      ),
    };

    // 依次求值，按 scope 分类
    for (const f of sorted) {
      try {
        // PRD 4.2：条件公式 —— 条件为假时该项不计入
        if (f.condition && f.condition.trim()) {
          const condVal = evaluateExpression(f.condition, scope, allowed);
          if (condVal === 0) {
            const skipped = { name: f.name, expression: f.expression, value: 0, note: '【条件不满足，未计入】' };
            if (f.scope === 'injection') customResults.injection.push(skipped);
            else if (f.scope === 'summary') customResults.summary.push(skipped);
            else customResults.mold.push(skipped);
            scope[f.name] = 0;
            if (f.code) scope[f.code] = 0;
            continue;
          }
        }

        const v = evaluateExpression(f.expression, scope, allowed);
        const rounded = Math.round(v * 100) / 100;
        scope[f.name] = rounded; // 后续公式可引用
        if (f.code) scope[f.code] = rounded;
        if (f.scope === 'mold') {
          moldCustom += rounded;
          customResults.mold.push({
            name: f.name,
            expression: f.expression,
            value: rounded,
            note: f.note,
          });
        } else if (f.scope === 'injection') {
          injectionCustom += rounded;
          customResults.injection.push({
            name: f.name,
            expression: f.expression,
            value: rounded,
            note: f.note,
          });
        } else {
          // summary scope：直接累加到 moldTotalExVat（暂以 moldCustom 形式实现）
          moldCustom += rounded;
          customResults.summary.push({
            name: f.name,
            expression: f.expression,
            value: rounded,
            note: f.note,
          });
        }
      } catch (e: any) {
        // 单个公式失败不阻塞整单，记录到 note
        customResults.mold.push({
          name: f.name,
          expression: f.expression,
          value: 0,
          note: `【错误】${e.message}`,
        });
      }
    }
  }

  // 重算汇总（注入最终值）
  const summary = calcSummary(
    moldFeeItems,
    injectionItems,
    input,
    { moldExtrasTotal, injectionExtrasUnit },
    { moldCustom, injectionCustom },
  );

  // 商务条款
  const businessTerms = applyBusinessTermOverrides(req.businessTermOverrides);

  return {
    moldFeeItems,
    injectionItems,
    summary,
    businessTerms,
    extras: {
      moldExtras: moldExtras.map((e) => ({
        id: e.id,
        name: e.name,
        amount: Number(e.amount) || 0,
        note: e.note,
      })),
      injectionExtras: injectionExtras.map((e) => ({
        id: e.id,
        name: e.name,
        amount: Number(e.amount) || 0,
        note: e.note,
      })),
    },
    customFormulas: customResults,
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
