// 预置模具类型模板 — 新企业开通时一键生成三套可用配置
// 用户可以在此基础上随意增删改，也可以全部删掉自己建。

export interface PresetParam {
  code: string;
  name: string;
  value: number;
  unit: string;
  group: string;
}

export interface PresetItem {
  name: string;
  category: string;
  scope: 'mold' | 'injection';
  calcType: string;
  calcConfig: Record<string, unknown>;
}

export interface PresetMaterial {
  code: string;
  name: string;
  category: string;
  unit: string;
  price: number;
  lossRate: number;
  density?: number;
}

export interface PresetMoldType {
  code: string;
  name: string;
  profitRate: number;
  taxRate: number;
  params: PresetParam[];
  materials: PresetMaterial[];
  terms: string[];
  items: PresetItem[];
}

const BASE: PresetParam[] = [
  { code: 'cavityCount', name: '腔数', value: 2, unit: '穴', group: '产品' },
  { code: 'firstOrderQty', name: '首单数量', value: 300000, unit: '件', group: '商务' },
];

export const MOLD_PRESETS: PresetMoldType[] = [
  {
    code: 'injection',
    name: '注塑模具',
    profitRate: 0.1,
    taxRate: 0.13,
    params: [
      { code: 'cavityCount', name: '腔数', value: 2, unit: '穴', group: '产品' },
      { code: 'singleWeightKg', name: '单件重量', value: 0.18, unit: 'kg', group: '产品' },
      { code: 'coreLengthMm', name: '模芯长', value: 500, unit: 'mm', group: '模具' },
      { code: 'coreWidthMm', name: '模芯宽', value: 400, unit: 'mm', group: '模具' },
      { code: 'coreHeightMm', name: '模芯高', value: 150, unit: 'mm', group: '模具' },
      { code: 'materialPrice', name: '钢材单价', value: 25, unit: '元/kg', group: '材料' },
      { code: 'steelDensity', name: '钢材密度', value: 7.85, unit: 'g/cm³', group: '材料' },
      { code: 'firstOrderQty', name: '首单数量', value: 300000, unit: '件', group: '商务' },
    ],
    materials: [
      { code: 'ABS', name: 'ABS', category: '塑料原料', unit: 'kg', price: 12, lossRate: 0.05, density: 1.05 },
      { code: 'PP', name: 'PP', category: '塑料原料', unit: 'kg', price: 9.5, lossRate: 0.05, density: 0.9 },
      { code: 'PC', name: 'PC', category: '塑料原料', unit: 'kg', price: 26, lossRate: 0.05, density: 1.2 },
      { code: 'P20', name: 'P20 预硬钢', category: '模具钢材', unit: 'kg', price: 25, lossRate: 0.1, density: 7.85 },
      { code: '718H', name: '718H 预硬钢', category: '模具钢材', unit: 'kg', price: 32, lossRate: 0.1, density: 7.85 },
    ],
    terms: [
      '以上总价含 13% 增值税，开具增值税专用发票。',
      '广东省内运费免费，省外按实际运输方式另行计费。',
      '模具 40 天交货，首单注塑于收到定金后 45 天交付。',
    ],
    items: [
      { name: '模芯钢材费', category: '材料费', scope: 'mold', calcType: 'size',
        calcConfig: { l: '模芯长', w: '模芯宽', h: '模芯高', density: 7.85, priceVar: '钢材单价' } },
      { name: 'CNC 加工费', category: 'CNC', scope: 'mold', calcType: 'hours', calcConfig: { hours: 96, rate: 400 } },
      { name: '设计费', category: '自定义', scope: 'mold', calcType: 'fixed', calcConfig: { amount: 6000 } },
      { name: '试模费', category: '试模', scope: 'mold', calcType: 'qty', calcConfig: { src: '腔数', price: 2500 } },
      { name: '管理费', category: '管理费', scope: 'mold', calcType: 'percent', calcConfig: { base: '模具小计', rate: 0.15 } },
    ],
  },
  {
    code: 'diecast',
    name: '压铸模具',
    profitRate: 0.1,
    taxRate: 0.13,
    params: [
      { code: 'projectionArea', name: '投影面积', value: 320, unit: 'cm²', group: '产品' },
      { code: 'wallThickness', name: '平均壁厚', value: 2.5, unit: 'mm', group: '产品' },
      { code: 'machineTonnage', name: '压铸机吨位', value: 800, unit: 'T', group: '设备' },
      { code: 'singleWeightKg', name: '单件重量', value: 0.86, unit: 'kg', group: '产品' },
      { code: 'dieLife', name: '模具寿命', value: 100000, unit: '模次', group: '模具' },
      { code: 'alloyPrice', name: '合金单价', value: 22, unit: '元/kg', group: '材料' },
      { code: 'firstOrderQty', name: '首单数量', value: 50000, unit: '件', group: '商务' },
    ],
    materials: [
      { code: 'ADC12', name: 'ADC12 铝合金', category: '压铸合金', unit: 'kg', price: 22, lossRate: 0.08, density: 2.7 },
      { code: 'ZAMAK3', name: '锌合金 3#', category: '压铸合金', unit: 'kg', price: 19, lossRate: 0.08, density: 6.6 },
      { code: 'H13', name: 'H13 热作钢', category: '模具钢材', unit: 'kg', price: 45, lossRate: 0.12, density: 7.85 },
    ],
    terms: [
      '模具材质 H13 热作钢，含真空阀与强化冷却回路。',
      '试模 3 次以内不另计费，超出按每次 3000 元计。',
    ],
    items: [
      { name: '模芯热作钢费', category: '材料费', scope: 'mold', calcType: 'size',
        calcConfig: { l: '投影面积', w: '平均壁厚', h: '', density: 2.7, priceVar: '合金单价' } },
      { name: '强冷却回路', category: '自定义', scope: 'mold', calcType: 'qty', calcConfig: { src: '投影面积', price: 45 } },
      { name: '真空阀与管路', category: '自定义', scope: 'mold', calcType: 'fixed', calcConfig: { amount: 18000 } },
      { name: '压铸机加工费', category: 'CNC', scope: 'mold', calcType: 'hours', calcConfig: { hours: 120, rate: 420 } },
      { name: '管理费', category: '管理费', scope: 'mold', calcType: 'percent', calcConfig: { base: '模具小计', rate: 0.15 } },
    ],
  },
  {
    code: 'twocolor',
    name: '双色模具',
    profitRate: 0.1,
    taxRate: 0.13,
    params: [
      { code: 'cavityCount', name: '腔数', value: 2, unit: '穴', group: '产品' },
      { code: 'coreLengthMm', name: '模芯长', value: 420, unit: 'mm', group: '模具' },
      { code: 'coreWidthMm', name: '模芯宽', value: 320, unit: 'mm', group: '模具' },
      { code: 'coreHeightMm', name: '模芯高', value: 180, unit: 'mm', group: '模具' },
      { code: 'hotRunnerPoints', name: '热流道点数', value: 4, unit: '点', group: '模具' },
      { code: 'firstOrderQty', name: '首单数量', value: 120000, unit: '件', group: '商务' },
    ],
    materials: [
      { code: 'ABS-H', name: 'ABS 硬胶', category: '塑料原料', unit: 'kg', price: 12, lossRate: 0.05, density: 1.05 },
      { code: 'TPE-S', name: 'TPE 软胶', category: '塑料原料', unit: 'kg', price: 35, lossRate: 0.06, density: 1.2 },
      { code: '718H', name: '718H 预硬钢', category: '模具钢材', unit: 'kg', price: 32, lossRate: 0.1, density: 7.85 },
    ],
    terms: [
      '含两套热流道，旋转机构质保 12 个月。',
      '双色试模 5 次，超出部分按每次 3000 元计费。',
    ],
    items: [
      { name: '旋转转盘机构', category: '自定义', scope: 'mold', calcType: 'fixed', calcConfig: { amount: 86000 } },
      { name: '第一套热流道', category: '热流道', scope: 'mold', calcType: 'qty', calcConfig: { src: '热流道点数', price: 8000 } },
      { name: '第二套热流道', category: '热流道', scope: 'mold', calcType: 'qty', calcConfig: { src: '热流道点数', price: 8000 } },
      { name: '双色合模调试', category: '试模', scope: 'mold', calcType: 'fixed', calcConfig: { amount: 12000 } },
      { name: '管理费', category: '管理费', scope: 'mold', calcType: 'percent', calcConfig: { base: '模具小计', rate: 0.15 } },
    ],
  },
];
