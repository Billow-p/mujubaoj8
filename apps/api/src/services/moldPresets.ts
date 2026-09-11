// 预置模具类型模板 — 新企业开通时一键生成三套可用配置
// 用户可以在此基础上随意增删改，也可以全部删掉自己建。

export interface PresetParam {
  code: string;
  name: string;
  value: number | string;
  unit: string;
  group: string;
  /** 参数控件类型：decimal（默认，数字输入）| select（下拉） */
  type?: string;
  /** type='select' 时的选项，value 必须是数字（公式里按数值参与计算） */
  options?: { label: string; value: number }[];
  /** 参数作用域：mold=模具专属 / injection=注塑件专属 / common=整单共享 */
  scope?: 'mold' | 'injection' | 'common';
}

export interface PresetItem {
  name: string;
  category: string;
  scope: 'mold' | 'injection';
  calcType: string;
  /** formula 模式不用它，所以可选 */
  calcConfig?: Record<string, unknown>;
  /** 按件计价：算出来的是单件成本，总额 = 单件成本 × 注塑数量 */
  perUnit?: boolean;
  /** calcType='formula' 时使用 */
  expression?: string;
}

export interface PresetMaterial {
  code: string;
  name: string;
  category: string; // 一级分类：用途场景
  subCategory?: string; // 二级分类：材质体系
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

// 数量参数由各模具类型自己带（注塑数量 / 压铸数量 / 成型数量）。
// 原 BASE 里的「首单数量」与「注塑数量」语义重复，已移除。
const BASE: PresetParam[] = [
  { code: 'cavityCount', name: '腔数', value: 2, unit: '穴', group: '产品' },
];

export const MOLD_PRESETS: PresetMoldType[] = [
  {
    code: 'injection',
    name: '注塑模具',
    profitRate: 0.1,
    taxRate: 0.13,
    params: [
      { code: 'cavityCount', name: '腔数', value: 2, unit: '穴', group: '产品', scope: 'mold' },
      { code: 'singleWeightKg', name: '单件重量', value: 0.18, unit: 'kg', group: '产品', scope: 'injection' },
      { code: 'coreLengthMm', name: '模芯长', value: 500, unit: 'mm', group: '模具', scope: 'mold' },
      { code: 'coreWidthMm', name: '模芯宽', value: 400, unit: 'mm', group: '模具', scope: 'mold' },
      { code: 'coreHeightMm', name: '模芯高', value: 150, unit: 'mm', group: '模具', scope: 'mold' },
      { code: 'materialPrice', name: '钢材单价', value: 25, unit: '元/kg', group: '材料', scope: 'common' },
      { code: 'steelDensity', name: '钢材密度', value: 7.85, unit: 'g/cm³', group: '材料', scope: 'common' },
      { code: 'steelLossRate', name: '钢材损耗率', value: 0.1, unit: '', group: '材料', scope: 'common' },
      { code: 'materialUnitPrice', name: '原料单价', value: 12, unit: '元/kg', group: '材料', scope: 'injection' },
      { code: 'injectionQty', name: '注塑数量', value: 5000, unit: '件', group: '商务', scope: 'injection' },
      // 运输费要用到的量
      { code: 'moldWeightKg', name: '模具重量', value: 800, unit: 'kg', group: '运输', scope: 'mold' },
      { code: 'packLengthCm', name: '运输箱长', value: 120, unit: 'cm', group: '运输', scope: 'common' },
      { code: 'packWidthCm', name: '运输箱宽', value: 100, unit: 'cm', group: '运输', scope: 'common' },
      { code: 'packHeightCm', name: '运输箱高', value: 80, unit: 'cm', group: '运输', scope: 'common' },
      { code: 'freightRate', name: '运费单价', value: 1.2, unit: '元/kg', group: '运输', scope: 'common' },
      {
        code: 'freightZone', name: '运输区域', value: '1', unit: '', group: '运输', type: 'select', scope: 'common',
        options: [
          { label: '广东省内（免运费）', value: 0 },
          { label: '广东省外', value: 1 },
        ],
      },
    ],
    materials: [
      { code: 'ABS', name: 'ABS', category: '塑料原料', subCategory: '通用塑料', unit: 'kg', price: 12, lossRate: 0.05, density: 1.05 },
      { code: 'PP', name: 'PP', category: '塑料原料', subCategory: '通用塑料', unit: 'kg', price: 9.5, lossRate: 0.05, density: 0.9 },
      { code: 'PC', name: 'PC', category: '塑料原料', subCategory: '工程塑料', unit: 'kg', price: 26, lossRate: 0.05, density: 1.2 },
      { code: 'P20', name: 'P20 预硬钢', category: '模具钢材', subCategory: '预硬塑胶模具钢', unit: 'kg', price: 25, lossRate: 0.1, density: 7.85 },
      { code: '718H', name: '718H 预硬钢', category: '模具钢材', subCategory: '预硬塑胶模具钢', unit: 'kg', price: 32, lossRate: 0.1, density: 7.85 },
    ],
    terms: [
      '以上总价含 13% 增值税，开具增值税专用发票。',
      '运费：广东省内免运费；省外运费已按模具重量与包装体积核算，并包含在上述总价内。',
      '模具 40 天交货，首单注塑于收到定金后 45 天交付。',
    ],
    items: [
      // ------- 模具费用（一次性） -------
      // 钢材来自材料库（方案 A）：选了牌号就按该牌号的单价/密度/损耗率算；
      // 没选则回落到「钢材单价 / 钢材密度 / 钢材损耗率」这三个公共参数。
      { name: '模芯钢材费', category: '材料费', scope: 'mold', calcType: 'size',
        calcConfig: { l: '模芯长', w: '模芯宽', h: '模芯高', density: 7.85, densityVar: '钢材密度', priceVar: '钢材单价', lossVar: '钢材损耗率' } },
      { name: 'CNC 加工费', category: 'CNC', scope: 'mold', calcType: 'hours', calcConfig: { hours: 96, rate: 400 } },
      { name: '设计费', category: '自定义', scope: 'mold', calcType: 'fixed', calcConfig: { amount: 6000 } },
      { name: '试模费', category: '试模', scope: 'mold', calcType: 'qty', calcConfig: { src: '腔数', price: 2500 } },
      // 运输费：广东省内免运费（区域系数 0）；省外按「实际重量与体积重量取大者 × 单价」
      // 体积重量 = 长 × 宽 × 高 ÷ 6000（物流行业通用材积系数，单位 kg）
      { name: '运输费', category: '运输', scope: 'mold', calcType: 'formula',
        expression: '最大值 ( 模具重量, 运输箱长 * 运输箱宽 * 运输箱高 / 6000 ) * 运费单价 * 运输区域' },

      // ------- 注塑费用（按件计价：单件成本 × 注塑数量） -------
      { name: '产品材料费', category: '注塑材料', scope: 'injection', calcType: 'weight', perUnit: true,
        calcConfig: { wVar: '单件重量', priceVar: '原料单价', loss: 0.05 } },
      { name: '注塑加工费', category: '注塑加工', scope: 'injection', calcType: 'fixed', perUnit: true,
        calcConfig: { amount: 0.3 } },
      { name: '包装费', category: '注塑包装', scope: 'injection', calcType: 'fixed', perUnit: true,
        calcConfig: { amount: 0.05 } },
    ],
  },
  {
    code: 'diecast',
    name: '压铸模具',
    profitRate: 0.1,
    taxRate: 0.13,
    params: [
      { code: 'projectionArea', name: '投影面积', value: 320, unit: 'cm²', group: '产品', scope: 'mold' },
      { code: 'wallThickness', name: '平均壁厚', value: 2.5, unit: 'mm', group: '产品', scope: 'mold' },
      { code: 'machineTonnage', name: '压铸机吨位', value: 800, unit: 'T', group: '设备', scope: 'mold' },
      { code: 'singleWeightKg', name: '单件重量', value: 0.86, unit: 'kg', group: '产品', scope: 'injection' },
      { code: 'dieLife', name: '模具寿命', value: 100000, unit: '模次', group: '模具', scope: 'mold' },
      { code: 'alloyPrice', name: '合金单价', value: 22, unit: '元/kg', group: '材料', scope: 'injection' },
      { code: 'castingQty', name: '压铸数量', value: 50000, unit: '件', group: '商务', scope: 'injection' },
    ],
    materials: [
      { code: 'ADC12', name: 'ADC12 铝合金', category: '压铸合金', subCategory: '铝合金', unit: 'kg', price: 22, lossRate: 0.08, density: 2.7 },
      { code: 'ZAMAK3', name: '锌合金 3#', category: '压铸合金', subCategory: '锌合金', unit: 'kg', price: 19, lossRate: 0.08, density: 6.6 },
      { code: 'H13', name: 'H13 热作钢', category: '模具钢材', subCategory: '热作模具钢', unit: 'kg', price: 45, lossRate: 0.12, density: 7.85 },
    ],
    terms: [
      '模具材质 H13 热作钢，含真空阀与强化冷却回路。',
      '试模 3 次以内不另计费，超出按每次 3000 元计。',
    ],
    items: [
      // 压铸模芯用热作钢：同样支持从材料库选牌号（H13 / 8407 / DAC55…）。
      // 注意 density/loss 仍保留原值作为「没选牌号时」的兜底，不改变老算法结果。
      { name: '模芯热作钢费', category: '材料费', scope: 'mold', calcType: 'size',
        calcConfig: { l: '投影面积', w: '平均壁厚', h: '', density: 2.7, densityVar: '钢材密度', priceVar: '合金单价', lossVar: '钢材损耗率' } },
      { name: '强冷却回路', category: '自定义', scope: 'mold', calcType: 'qty', calcConfig: { src: '投影面积', price: 45 } },
      { name: '真空阀与管路', category: '自定义', scope: 'mold', calcType: 'fixed', calcConfig: { amount: 18000 } },
      { name: '压铸机加工费', category: 'CNC', scope: 'mold', calcType: 'hours', calcConfig: { hours: 120, rate: 420 } },
    ],
  },
  {
    code: 'twocolor',
    name: '双色模具',
    profitRate: 0.1,
    taxRate: 0.13,
    params: [
      { code: 'cavityCount', name: '腔数', value: 2, unit: '穴', group: '产品', scope: 'mold' },
      { code: 'coreLengthMm', name: '模芯长', value: 420, unit: 'mm', group: '模具', scope: 'mold' },
      { code: 'coreWidthMm', name: '模芯宽', value: 320, unit: 'mm', group: '模具', scope: 'mold' },
      { code: 'coreHeightMm', name: '模芯高', value: 180, unit: 'mm', group: '模具', scope: 'mold' },
      { code: 'hotRunnerPoints', name: '热流道点数', value: 4, unit: '点', group: '模具', scope: 'mold' },
      { code: 'moldingQty', name: '成型数量', value: 120000, unit: '件', group: '商务', scope: 'injection' },
    ],
    materials: [
      { code: 'ABS-H', name: 'ABS 硬胶', category: '塑料原料', subCategory: '通用塑料', unit: 'kg', price: 12, lossRate: 0.05, density: 1.05 },
      { code: 'TPE-S', name: 'TPE 软胶', category: '塑料原料', subCategory: '弹性体软胶', unit: 'kg', price: 35, lossRate: 0.06, density: 1.2 },
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
    ],
  },
];
