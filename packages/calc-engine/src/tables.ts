// 价格表（基础数据）— 这些值可以由管理员在系统中修改
// 这里是 v0.1 的初始默认值

import type { ComplexityLevel, MaterialKey, SteelKey } from '@mqs/shared';

// 复杂度系数
export const COMPLEXITY_COEFF: Record<ComplexityLevel, number> = {
  simple: 0.7,
  medium: 1.0,
  complex: 1.5,
  ultra_precision: 2.5,
};

// 钢材系数（影响加工工时单价）
export const STEEL_COEFF: Record<SteelKey, number> = {
  P20: 1.0,
  '718H': 1.0,
  S136: 1.3,
  NAK80: 1.5,
  H13: 1.4,
  S50C: 0.9,
};

// 材料单价（元/kg）
export const MATERIAL_UNIT_PRICE: Record<MaterialKey, number> = {
  ABS: 12,
  PP: 9,
  PE: 10,
  PA: 22,
  PC: 25,
  POM: 18,
  PMMA: 20,
  PBT: 16,
};

// 钢材单价（元/kg）
export const STEEL_UNIT_PRICE: Record<SteelKey, number> = {
  P20: 25,
  '718H': 28,
  S136: 45,
  NAK80: 58,
  H13: 42,
  S50C: 22,
};

// 工时费率（元/小时）
export const HOURLY_RATE = {
  CNC: 400,
  EDM: 600,
  polishing: 200,   // 抛光
  wireCutting: 150, // 线切割
  trialMold: 500,   // 试模（含材料）
} as const;

// 工时基数（按复杂度级别调整）
export const BASE_HOURS = {
  CNC: 80,        // 基础 CNC 工时
  EDM: 30,        // 基础 EDM 工时
  polishing: 30,  // 抛光工时
  wireCutting: 20,// 线切割工时
  trialMold: 2,   // 试模次数
} as const;

// 模架价格表：按 (长区间上限, 宽区间上限) → 价格（元）
// v0.1 用简单的"长×宽面积"分级
export const MOLD_BASE_PRICE_TABLE: Array<{
  maxArea: number; // 长×宽 ≤ maxArea
  price: number;
}> = [
  { maxArea: 50000, price: 25000 },   // ≤ 7071mm² (e.g. 200×250)
  { maxArea: 100000, price: 35000 },  // ≤ 100000mm² (e.g. 250×400)
  { maxArea: 200000, price: 42000 },  // ≤ 200000mm² (e.g. 400×500) ← 当前示例
  { maxArea: 400000, price: 65000 },
  { maxArea: 800000, price: 95000 },
  { maxArea: Infinity, price: 150000 },
];

// 标准件单价（元/穴 = 每腔）
export const STANDARD_PARTS_PER_CAVITY = 8000;

// 试模基础价
export const TRIAL_MOLD_BASE = 4000;

// 表面处理单价（元/穴）
export const SURFACE_TREATMENT_PER_CAVITY = 5000;

// 省内运费
export const PROVINCE_INNER_SHIPPING = 3000;

// 后加工单价表（元/件）
export const POST_PROCESS_UNIT_PRICE: Record<string, number> = {
  '去飞边': 0.10,
  '去飞边/装箱': 0.15,
  '喷涂': 1.50,
  '丝印': 0.80,
  '超声波焊接': 2.00,
};

// 包装费默认值
export const DEFAULT_PACKAGING_FEE = 0.10;
