// 预置模具类型模板 — 新企业开通时一键生成四套可用配置
// 用户可以在此基础上随意增删改，也可以全部删掉自己建。
//
// 同步规则（稳定安全）：
//   1) 参数/费用项只「补缺失」，已存在的绝不覆盖（用户改过的配置不会丢）；
//   2) 价格参数通过 materialCode 绑定默认材料（材料库为价格真源），
//      「从材料库同步价格」只给当前为空/0 的参数填价，已设值一律不动。

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
  /**
   * 价格真源绑定：该参数的价取自全局材料库里这个编码的材料。
   * 只用于「从材料库同步价格」——只补空/0，不覆盖已设值。
   */
  materialCode?: string;
}

export interface PresetItem {
  name: string;
  category: string;
  scope: 'mold' | 'injection';
  calcType: string;
  /** formula 模式不用它，所以可选 */
  calcConfig?: Record<string, unknown>;
  /** 按件计价：算出来的是单件成本，总额 = 单件成本 × 数量 */
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

// 运输费公式（四套类型通用）：实际重量与体积重量取大者 × 单价 × 区域系数
const FREIGHT_EXPR = '最大值 ( 模具重量, 运输箱长 * 运输箱宽 * 运输箱高 / 6000 ) * 运费单价 * 运输区域';

// 标准模架下拉（注塑/双色用；压铸、橡胶吨位小些，单列一套）
const MOLD_BASE_OPTIONS = [
  { label: '不另计模架费', value: 0 },
  { label: '3030 标准模架', value: 3500 },
  { label: '3035 标准模架', value: 4200 },
  { label: '3535 标准模架', value: 5600 },
  { label: '3540 标准模架', value: 6500 },
  { label: '4040 标准模架', value: 8600 },
  { label: '4050 标准模架', value: 9800 },
  { label: '4550 标准模架', value: 12500 },
  { label: '5050 标准模架', value: 15600 },
];
// 小型模架（橡胶/小型压铸）
const SMALL_BASE_OPTIONS = [
  { label: '不另计模架费', value: 0 },
  { label: '2025 标准模架', value: 2200 },
  { label: '2530 标准模架', value: 2800 },
  { label: '3030 标准模架', value: 3500 },
  { label: '3035 标准模架', value: 4200 },
  { label: '3535 标准模架', value: 5600 },
];

export const MOLD_PRESETS: PresetMoldType[] = [
  {
    code: 'injection',
    name: '注塑模具',
    profitRate: 0.1,
    taxRate: 0.13,
    params: [
      { code: 'cavityCount', name: '腔数', value: 2, unit: '穴', group: '产品', scope: 'common' },
      { code: 'singleWeightKg', name: '单件重量', value: 0.18, unit: 'kg', group: '产品', scope: 'injection' },
      { code: 'coreLengthMm', name: '模芯长', value: 500, unit: 'mm', group: '模具', scope: 'mold' },
      { code: 'coreWidthMm', name: '模芯宽', value: 400, unit: 'mm', group: '模具', scope: 'mold' },
      { code: 'coreHeightMm', name: '模芯高', value: 150, unit: 'mm', group: '模具', scope: 'mold' },
      // ↓ 新增项：默认都是 0，不填就不计钱（不会改变已有报价的金额）
      { code: 'moldBaseSpec', name: '模架规格', value: '0', unit: '', group: '模具', type: 'select', scope: 'mold',
        options: MOLD_BASE_OPTIONS },
      { code: 'hotRunnerPoints', name: '热流道点数', value: 0, unit: '点', group: '模具', scope: 'mold' },
      // 注意：参数名里**不要有空格** —— 公式求值器按标识符解析，带空格会被拆开导致算不出值
      { code: 'edmHours', name: 'EDM工时', value: 0, unit: '小时', group: '模具', scope: 'mold' },
      { code: 'wireCutLength', name: '线切割长度', value: 0, unit: 'mm', group: '模具', scope: 'mold' },
      { code: 'polishHours', name: '抛光工时', value: 0, unit: '小时', group: '模具', scope: 'mold' },
      { code: 'materialPrice', name: '钢材单价', value: 25, unit: '元/kg', group: '材料', scope: 'common', materialCode: 'P20' },
      { code: 'steelDensity', name: '钢材密度', value: 7.85, unit: 'g/cm³', group: '材料', scope: 'common' },
      { code: 'steelLossRate', name: '钢材损耗率', value: 0.1, unit: '', group: '材料', scope: 'common' },
      { code: 'materialUnitPrice', name: '原料单价', value: 12, unit: '元/kg', group: '材料', scope: 'injection', materialCode: 'ABS' },
      // 原料损耗率：选了材料库材料时用该牌号的损耗率，未选则用这里的值（默认与旧固定值一致）
      { code: 'materialLossRate', name: '原料损耗率', value: 0.05, unit: '', group: '材料', scope: 'injection' },
      { code: 'injectionQty', name: '注塑数量', value: 5000, unit: '件', group: '商务', scope: 'injection' },
      // 机台费 = 机台时薪 × 成型周期 ÷ 3600 ÷ 腔数（单件成本）
      { code: 'machineHourlyRate', name: '机台时薪', value: 130, unit: '元/小时', group: '注塑', scope: 'injection' },
      { code: 'cycleTime', name: '成型周期', value: 30, unit: '秒', group: '注塑', scope: 'injection' },
      // 运输费要用到的量
      { code: 'moldWeightKg', name: '模具重量', value: 800, unit: 'kg', group: '运输', scope: 'mold' },
      { code: 'packLengthCm', name: '运输箱长', value: 120, unit: 'cm', group: '运输', scope: 'common' },
      { code: 'packWidthCm', name: '运输箱宽', value: 100, unit: 'cm', group: '运输', scope: 'common' },
      { code: 'packHeightCm', name: '运输箱高', value: 80, unit: 'cm', group: '运输', scope: 'common' },
      { code: 'freightRate', name: '运费单价', value: 1.2, unit: '元/kg', group: '运输', scope: 'common' },
      {
        code: 'freightZone', name: '运输区域', value: '0', unit: '', group: '运输', type: 'select', scope: 'common',
        options: [
          { label: '广东省内（免运费）', value: 0 },
          { label: '广东省外（按正常运费）', value: 1 },
          { label: '偏远地区（运费加倍）', value: 2 },
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
      // ------- 下面这批默认都是 0，报价时不填就不计钱 -------
      // 模架（模胚）：标准模架按规格选，选「不另计模架费」就是 0
      { name: '模架费', category: '模架', scope: 'mold', calcType: 'qty', calcConfig: { src: '模架规格', price: 1 } },
      { name: '热流道费', category: '热流道', scope: 'mold', calcType: 'qty', calcConfig: { src: '热流道点数', price: 8000 } },
      { name: 'EDM放电费', category: 'CNC', scope: 'mold', calcType: 'qty', calcConfig: { src: 'EDM工时', price: 220 } },
      { name: '线切割费', category: 'CNC', scope: 'mold', calcType: 'qty', calcConfig: { src: '线切割长度', price: 8 } },
      { name: '抛光省模费', category: '表面处理', scope: 'mold', calcType: 'qty', calcConfig: { src: '抛光工时', price: 120 } },
      // 这几项没有客观计量，报价时手填金额，不填就是 0
      { name: '标准件费', category: '标准件', scope: 'mold', calcType: 'manual' },
      { name: '滑块斜顶镶件', category: '自定义', scope: 'mold', calcType: 'manual' },
      { name: '热处理费', category: '热处理', scope: 'mold', calcType: 'manual' },
      { name: '表面处理费', category: '表面处理', scope: 'mold', calcType: 'manual' },
      // 运输费：广东省内免运费（区域系数 0）；省外按「实际重量与体积重量取大者 × 单价」
      // 体积重量 = 长 × 宽 × 高 ÷ 6000（物流行业通用材积系数，单位 kg）
      { name: '运输费', category: '运输', scope: 'mold', calcType: 'formula', expression: FREIGHT_EXPR },
      // 运输附加费：区域系数解决不了的固定加价（如加急、木箱、保险）在这里手填，不填为 0
      { name: '运输附加费', category: '运输', scope: 'mold', calcType: 'manual' },

      // ------- 注塑费用（按件计价：单件成本 × 注塑数量） -------
      // 材料单价与损耗率都来自材料库（选了牌号就按牌号走，没选则用配置里的固定值）
      { name: '产品材料费', category: '注塑材料', scope: 'injection', calcType: 'weight', perUnit: true,
        calcConfig: { wVar: '单件重量', priceVar: '原料单价', loss: 0.05, lossVar: '原料损耗率' } },
      // 机台费：主流算法 —— 时薪 ÷ 每小时产出。周期越短、腔数越多，单件越便宜
      { name: '机台费', category: '注塑加工', scope: 'injection', calcType: 'formula', perUnit: true,
        expression: '机台时薪 * 成型周期 / 3600 / 腔数' },
      { name: '后加工费', category: '后加工', scope: 'injection', calcType: 'manual', perUnit: true },
      { name: '模具分摊费', category: '模具分摊', scope: 'injection', calcType: 'manual', perUnit: true },
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
      // —— 以下 code 与既有线上数据保持一致，避免同步时重复 ——
      { code: 'cavityCount', name: '腔数', value: 2, unit: '穴', group: '产品', scope: 'common' },
      { code: 'projectionArea', name: '投影面积', value: 320, unit: 'cm²', group: '产品', scope: 'mold' },
      { code: 'wallThickness', name: '平均壁厚', value: 2.5, unit: 'mm', group: '产品', scope: 'mold' },
      { code: 'machineTonnage', name: '压铸机吨位', value: 800, unit: 'T', group: '设备', scope: 'mold' },
      { code: 'singleWeightKg', name: '单件重量', value: 0.86, unit: 'kg', group: '产品', scope: 'injection' },
      { code: 'dieLife', name: '模具寿命', value: 100000, unit: '模次', group: '模具', scope: 'mold' },
      { code: 'castingQty', name: '压铸数量', value: 50000, unit: '件', group: '商务', scope: 'injection' },
      // —— 主流补齐项 ——
      { code: 'coreLengthMm', name: '模芯长', value: 500, unit: 'mm', group: '模具', scope: 'mold' },
      { code: 'coreWidthMm', name: '模芯宽', value: 400, unit: 'mm', group: '模具', scope: 'mold' },
      { code: 'coreHeightMm', name: '模芯高', value: 150, unit: 'mm', group: '模具', scope: 'mold' },
      { code: 'moldBaseSpec', name: '模架规格', value: '0', unit: '', group: '模具', type: 'select', scope: 'mold',
        options: MOLD_BASE_OPTIONS },
      { code: 'moldWeightKg', name: '模具重量', value: 1200, unit: 'kg', group: '运输', scope: 'mold' },
      { code: 'edmHours', name: 'EDM工时', value: 0, unit: '小时', group: '模具', scope: 'mold' },
      { code: 'wireCutLength', name: '线切割长度', value: 0, unit: 'mm', group: '模具', scope: 'mold' },
      { code: 'polishHours', name: '抛光工时', value: 0, unit: '小时', group: '模具', scope: 'mold' },
      // 压铸模芯用热作钢，默认价跟 H13 走
      { code: 'steelPrice', name: '钢材单价', value: 45, unit: '元/kg', group: '材料', scope: 'common', materialCode: 'H13' },
      { code: 'steelDensity', name: '钢材密度', value: 7.85, unit: 'g/cm³', group: '材料', scope: 'common' },
      { code: 'steelLossRate', name: '钢材损耗率', value: 0.12, unit: '', group: '材料', scope: 'common' },
      { code: 'alloyPrice', name: '合金单价', value: 22, unit: '元/kg', group: '材料', scope: 'injection', materialCode: 'ADC12' },
      { code: 'alloyLossRate', name: '合金损耗率', value: 0.08, unit: '', group: '材料', scope: 'injection' },
      { code: 'machineHourlyRate', name: '机台时薪', value: 150, unit: '元/小时', group: '压铸', scope: 'injection' },
      { code: 'cycleTime', name: '压铸周期', value: 40, unit: '秒', group: '压铸', scope: 'injection' },
      { code: 'packLengthCm', name: '运输箱长', value: 130, unit: 'cm', group: '运输', scope: 'common' },
      { code: 'packWidthCm', name: '运输箱宽', value: 110, unit: 'cm', group: '运输', scope: 'common' },
      { code: 'packHeightCm', name: '运输箱高', value: 90, unit: 'cm', group: '运输', scope: 'common' },
      { code: 'freightRate', name: '运费单价', value: 1.2, unit: '元/kg', group: '运输', scope: 'common' },
      {
        code: 'freightZone', name: '运输区域', value: '0', unit: '', group: '运输', type: 'select', scope: 'common',
        options: [
          { label: '广东省内（免运费）', value: 0 },
          { label: '广东省外（按正常运费）', value: 1 },
          { label: '偏远地区（运费加倍）', value: 2 },
        ],
      },
    ],
    materials: [
      { code: 'ADC12', name: 'ADC12 铝合金', category: '压铸合金', subCategory: '铝合金', unit: 'kg', price: 22, lossRate: 0.08, density: 2.7 },
      { code: 'ZAMAK3', name: '锌合金 3#', category: '压铸合金', subCategory: '锌合金', unit: 'kg', price: 19, lossRate: 0.08, density: 6.6 },
      { code: 'H13', name: 'H13 热作钢', category: '模具钢材', subCategory: '热作模具钢', unit: 'kg', price: 45, lossRate: 0.12, density: 7.85 },
    ],
    terms: [
      '以上总价含 13% 增值税，开具增值税专用发票。',
      '模具材质 H13 热作钢，含真空阀与强化冷却回路。',
      '试模 3 次以内不另计费，超出按每次 3000 元计。',
    ],
    items: [
      // 模芯用热作钢（模芯长×宽×高 × 密度 × 单价 × (1+损耗率)）
      { name: '模芯热作钢费', category: '材料费', scope: 'mold', calcType: 'size',
        calcConfig: { l: '模芯长', w: '模芯宽', h: '模芯高', density: 7.85, densityVar: '钢材密度', priceVar: '钢材单价', lossVar: '钢材损耗率' } },
      { name: 'CNC 加工费', category: 'CNC', scope: 'mold', calcType: 'hours', calcConfig: { hours: 120, rate: 420 } },
      { name: 'EDM放电费', category: 'CNC', scope: 'mold', calcType: 'qty', calcConfig: { src: 'EDM工时', price: 220 } },
      { name: '线切割费', category: 'CNC', scope: 'mold', calcType: 'qty', calcConfig: { src: '线切割长度', price: 8 } },
      { name: '抛光省模费', category: '表面处理', scope: 'mold', calcType: 'qty', calcConfig: { src: '抛光工时', price: 120 } },
      { name: '模架费', category: '模架', scope: 'mold', calcType: 'qty', calcConfig: { src: '模架规格', price: 1 } },
      { name: '试模费', category: '试模', scope: 'mold', calcType: 'qty', calcConfig: { src: '腔数', price: 3000 } },
      { name: '设计费', category: '自定义', scope: 'mold', calcType: 'fixed', calcConfig: { amount: 6000 } },
      { name: '强冷却回路', category: '自定义', scope: 'mold', calcType: 'fixed', calcConfig: { amount: 12000 } },
      { name: '真空阀与管路', category: '自定义', scope: 'mold', calcType: 'fixed', calcConfig: { amount: 18000 } },
      { name: '标准件费', category: '标准件', scope: 'mold', calcType: 'manual' },
      { name: '滑块斜顶镶件', category: '自定义', scope: 'mold', calcType: 'manual' },
      { name: '热处理费', category: '热处理', scope: 'mold', calcType: 'manual' },
      { name: '表面处理费', category: '表面处理', scope: 'mold', calcType: 'manual' },
      { name: '运输费', category: '运输', scope: 'mold', calcType: 'formula', expression: FREIGHT_EXPR },
      { name: '运输附加费', category: '运输', scope: 'mold', calcType: 'manual' },
      // —— 按件费用 ——
      // 压铸机加工费（模具侧机加工）沿用既有项；「压铸成型费」是每压一模的机台成本
      { name: '压铸成型费', category: '压铸加工', scope: 'injection', calcType: 'formula', perUnit: true,
        expression: '机台时薪 * 压铸周期 / 3600 / 腔数' },
      { name: '产品合金费', category: '压铸材料', scope: 'injection', calcType: 'weight', perUnit: true,
        calcConfig: { wVar: '单件重量', priceVar: '合金单价', loss: 0.08, lossVar: '合金损耗率' } },
      { name: '去毛刺费', category: '后加工', scope: 'injection', calcType: 'manual', perUnit: true },
      { name: '模具分摊费', category: '模具分摊', scope: 'injection', calcType: 'manual', perUnit: true },
      { name: '包装费', category: '压铸包装', scope: 'injection', calcType: 'fixed', perUnit: true,
        calcConfig: { amount: 0.08 } },
    ],
  },
  {
    code: 'twocolor',
    name: '双色模具',
    profitRate: 0.1,
    taxRate: 0.13,
    params: [
      // —— 以下 code 与既有线上数据保持一致 ——
      { code: 'cavityCount', name: '腔数', value: 2, unit: '穴', group: '产品', scope: 'common' },
      { code: 'coreLengthMm', name: '模芯长', value: 420, unit: 'mm', group: '模具', scope: 'mold' },
      { code: 'coreWidthMm', name: '模芯宽', value: 320, unit: 'mm', group: '模具', scope: 'mold' },
      { code: 'coreHeightMm', name: '模芯高', value: 180, unit: 'mm', group: '模具', scope: 'mold' },
      { code: 'hotRunnerPoints', name: '热流道点数', value: 4, unit: '点', group: '模具', scope: 'mold' },
      { code: 'moldingQty', name: '成型数量', value: 120000, unit: '件', group: '商务', scope: 'injection' },
      // —— 主流补齐项 ——
      { code: 'moldBaseSpec', name: '模架规格', value: '0', unit: '', group: '模具', type: 'select', scope: 'mold',
        options: MOLD_BASE_OPTIONS },
      { code: 'moldWeightKg', name: '模具重量', value: 1000, unit: 'kg', group: '运输', scope: 'mold' },
      { code: 'hardWeightKg', name: '硬胶重量', value: 0.15, unit: 'kg', group: '产品', scope: 'injection' },
      { code: 'softWeightKg', name: '软胶重量', value: 0.05, unit: 'kg', group: '产品', scope: 'injection' },
      { code: 'edmHours', name: 'EDM工时', value: 0, unit: '小时', group: '模具', scope: 'mold' },
      { code: 'wireCutLength', name: '线切割长度', value: 0, unit: 'mm', group: '模具', scope: 'mold' },
      { code: 'polishHours', name: '抛光工时', value: 0, unit: '小时', group: '模具', scope: 'mold' },
      // 双色模架多用预硬钢，默认价跟 718H 走
      { code: 'steelPrice', name: '钢材单价', value: 32, unit: '元/kg', group: '材料', scope: 'common', materialCode: '718H' },
      { code: 'steelDensity', name: '钢材密度', value: 7.85, unit: 'g/cm³', group: '材料', scope: 'common' },
      { code: 'steelLossRate', name: '钢材损耗率', value: 0.1, unit: '', group: '材料', scope: 'common' },
      { code: 'hardGluePrice', name: '硬胶单价', value: 12, unit: '元/kg', group: '材料', scope: 'injection', materialCode: 'ABS-H' },
      { code: 'hardGlueLossRate', name: '硬胶损耗率', value: 0.05, unit: '', group: '材料', scope: 'injection' },
      { code: 'softGluePrice', name: '软胶单价', value: 35, unit: '元/kg', group: '材料', scope: 'injection', materialCode: 'TPE-S' },
      { code: 'softGlueLossRate', name: '软胶损耗率', value: 0.06, unit: '', group: '材料', scope: 'injection' },
      { code: 'machineHourlyRate', name: '机台时薪', value: 180, unit: '元/小时', group: '注塑', scope: 'injection' },
      { code: 'cycleTime', name: '成型周期', value: 35, unit: '秒', group: '注塑', scope: 'injection' },
      { code: 'packLengthCm', name: '运输箱长', value: 120, unit: 'cm', group: '运输', scope: 'common' },
      { code: 'packWidthCm', name: '运输箱宽', value: 100, unit: 'cm', group: '运输', scope: 'common' },
      { code: 'packHeightCm', name: '运输箱高', value: 80, unit: 'cm', group: '运输', scope: 'common' },
      { code: 'freightRate', name: '运费单价', value: 1.2, unit: '元/kg', group: '运输', scope: 'common' },
      {
        code: 'freightZone', name: '运输区域', value: '0', unit: '', group: '运输', type: 'select', scope: 'common',
        options: [
          { label: '广东省内（免运费）', value: 0 },
          { label: '广东省外（按正常运费）', value: 1 },
          { label: '偏远地区（运费加倍）', value: 2 },
        ],
      },
    ],
    materials: [
      { code: 'ABS-H', name: 'ABS 硬胶', category: '塑料原料', subCategory: '通用塑料', unit: 'kg', price: 12, lossRate: 0.05, density: 1.05 },
      { code: 'TPE-S', name: 'TPE 软胶', category: '塑料原料', subCategory: '弹性体软胶', unit: 'kg', price: 35, lossRate: 0.06, density: 1.2 },
      { code: '718H', name: '718H 预硬钢', category: '模具钢材', unit: 'kg', price: 32, lossRate: 0.1, density: 7.85 },
    ],
    terms: [
      '以上总价含 13% 增值税，开具增值税专用发票。',
      '含两套热流道，旋转机构质保 12 个月。',
      '双色试模 5 次，超出部分按每次 3000 元计费。',
    ],
    items: [
      { name: '模芯钢材费', category: '材料费', scope: 'mold', calcType: 'size',
        calcConfig: { l: '模芯长', w: '模芯宽', h: '模芯高', density: 7.85, densityVar: '钢材密度', priceVar: '钢材单价', lossVar: '钢材损耗率' } },
      { name: 'CNC 加工费', category: 'CNC', scope: 'mold', calcType: 'hours', calcConfig: { hours: 110, rate: 400 } },
      { name: 'EDM放电费', category: 'CNC', scope: 'mold', calcType: 'qty', calcConfig: { src: 'EDM工时', price: 220 } },
      { name: '线切割费', category: 'CNC', scope: 'mold', calcType: 'qty', calcConfig: { src: '线切割长度', price: 8 } },
      { name: '抛光省模费', category: '表面处理', scope: 'mold', calcType: 'qty', calcConfig: { src: '抛光工时', price: 120 } },
      { name: '模架费', category: '模架', scope: 'mold', calcType: 'qty', calcConfig: { src: '模架规格', price: 1 } },
      { name: '试模费', category: '试模', scope: 'mold', calcType: 'qty', calcConfig: { src: '腔数', price: 3000 } },
      { name: '标准件费', category: '标准件', scope: 'mold', calcType: 'manual' },
      { name: '热处理费', category: '热处理', scope: 'mold', calcType: 'manual' },
      { name: '表面处理费', category: '表面处理', scope: 'mold', calcType: 'manual' },
      // —— 双色特有 ——
      { name: '旋转转盘机构', category: '自定义', scope: 'mold', calcType: 'fixed', calcConfig: { amount: 86000 } },
      { name: '第一套热流道', category: '热流道', scope: 'mold', calcType: 'qty', calcConfig: { src: '热流道点数', price: 8000 } },
      { name: '第二套热流道', category: '热流道', scope: 'mold', calcType: 'qty', calcConfig: { src: '热流道点数', price: 8000 } },
      { name: '双色合模调试', category: '试模', scope: 'mold', calcType: 'fixed', calcConfig: { amount: 12000 } },
      { name: '运输费', category: '运输', scope: 'mold', calcType: 'formula', expression: FREIGHT_EXPR },
      { name: '运输附加费', category: '运输', scope: 'mold', calcType: 'manual' },
      // —— 按件费用 ——
      { name: '硬胶材料费', category: '注塑材料', scope: 'injection', calcType: 'weight', perUnit: true,
        calcConfig: { wVar: '硬胶重量', priceVar: '硬胶单价', loss: 0.05, lossVar: '硬胶损耗率' } },
      { name: '软胶材料费', category: '注塑材料', scope: 'injection', calcType: 'weight', perUnit: true,
        calcConfig: { wVar: '软胶重量', priceVar: '软胶单价', loss: 0.06, lossVar: '软胶损耗率' } },
      { name: '机台费', category: '注塑加工', scope: 'injection', calcType: 'formula', perUnit: true,
        expression: '机台时薪 * 成型周期 / 3600 / 腔数' },
      { name: '后加工费', category: '后加工', scope: 'injection', calcType: 'manual', perUnit: true },
      { name: '模具分摊费', category: '模具分摊', scope: 'injection', calcType: 'manual', perUnit: true },
      { name: '包装费', category: '注塑包装', scope: 'injection', calcType: 'fixed', perUnit: true,
        calcConfig: { amount: 0.05 } },
    ],
  },
  {
    code: 'rubber',
    name: '橡胶模具',
    profitRate: 0.1,
    taxRate: 0.13,
    params: [
      { code: 'cavityCount', name: '腔数', value: 4, unit: '穴', group: '产品', scope: 'common' },
      { code: 'singleWeightKg', name: '单件重量', value: 0.05, unit: 'kg', group: '产品', scope: 'injection' },
      { code: 'coreLengthMm', name: '模芯长', value: 380, unit: 'mm', group: '模具', scope: 'mold' },
      { code: 'coreWidthMm', name: '模芯宽', value: 300, unit: 'mm', group: '模具', scope: 'mold' },
      { code: 'coreHeightMm', name: '模芯高', value: 120, unit: 'mm', group: '模具', scope: 'mold' },
      { code: 'moldBaseSpec', name: '模架规格', value: '0', unit: '', group: '模具', type: 'select', scope: 'mold',
        options: SMALL_BASE_OPTIONS },
      { code: 'moldWeightKg', name: '模具重量', value: 600, unit: 'kg', group: '运输', scope: 'mold' },
      { code: 'cureTonnage', name: '硫化机吨位', value: 200, unit: 'T', group: '设备', scope: 'mold' },
      { code: 'edmHours', name: 'EDM工时', value: 0, unit: '小时', group: '模具', scope: 'mold' },
      { code: 'wireCutLength', name: '线切割长度', value: 0, unit: 'mm', group: '模具', scope: 'mold' },
      { code: 'polishHours', name: '抛光工时', value: 0, unit: '小时', group: '模具', scope: 'mold' },
      { code: 'steelPrice', name: '钢材单价', value: 25, unit: '元/kg', group: '材料', scope: 'common', materialCode: 'P20' },
      { code: 'steelDensity', name: '钢材密度', value: 7.85, unit: 'g/cm³', group: '材料', scope: 'common' },
      { code: 'steelLossRate', name: '钢材损耗率', value: 0.1, unit: '', group: '材料', scope: 'common' },
      { code: 'rubberPrice', name: '橡胶单价', value: 45, unit: '元/kg', group: '材料', scope: 'injection', materialCode: 'SILICONE-R' },
      { code: 'rubberLossRate', name: '橡胶损耗率', value: 0.08, unit: '', group: '材料', scope: 'injection' },
      { code: 'vulcanizeQty', name: '硫化数量', value: 80000, unit: '件', group: '商务', scope: 'injection' },
      { code: 'machineHourlyRate', name: '机台时薪', value: 90, unit: '元/小时', group: '硫化', scope: 'injection' },
      { code: 'cureTime', name: '硫化周期', value: 60, unit: '秒', group: '硫化', scope: 'injection' },
      { code: 'packLengthCm', name: '运输箱长', value: 100, unit: 'cm', group: '运输', scope: 'common' },
      { code: 'packWidthCm', name: '运输箱宽', value: 80, unit: 'cm', group: '运输', scope: 'common' },
      { code: 'packHeightCm', name: '运输箱高', value: 70, unit: 'cm', group: '运输', scope: 'common' },
      { code: 'freightRate', name: '运费单价', value: 1.2, unit: '元/kg', group: '运输', scope: 'common' },
      {
        code: 'freightZone', name: '运输区域', value: '0', unit: '', group: '运输', type: 'select', scope: 'common',
        options: [
          { label: '广东省内（免运费）', value: 0 },
          { label: '广东省外（按正常运费）', value: 1 },
          { label: '偏远地区（运费加倍）', value: 2 },
        ],
      },
    ],
    materials: [
      { code: 'SILICONE-R', name: '硅胶（橡胶级）', category: '橡胶原料', subCategory: '硅橡胶', unit: 'kg', price: 45, lossRate: 0.08, density: 1.15 },
      { code: 'NR', name: '天然橡胶 NR', category: '橡胶原料', subCategory: '通用橡胶', unit: 'kg', price: 18, lossRate: 0.08, density: 0.92 },
      { code: 'P20', name: 'P20 预硬钢', category: '模具钢材', subCategory: '预硬塑胶模具钢', unit: 'kg', price: 25, lossRate: 0.1, density: 7.85 },
    ],
    terms: [
      '以上总价含 13% 增值税，开具增值税专用发票。',
      '模具 30 天交货，含一次免费试模。',
      '飞边毛刺按行业常规预留 0.1mm 撕边位。',
    ],
    items: [
      { name: '模芯钢材费', category: '材料费', scope: 'mold', calcType: 'size',
        calcConfig: { l: '模芯长', w: '模芯宽', h: '模芯高', density: 7.85, densityVar: '钢材密度', priceVar: '钢材单价', lossVar: '钢材损耗率' } },
      { name: 'CNC 加工费', category: 'CNC', scope: 'mold', calcType: 'hours', calcConfig: { hours: 72, rate: 380 } },
      { name: 'EDM放电费', category: 'CNC', scope: 'mold', calcType: 'qty', calcConfig: { src: 'EDM工时', price: 220 } },
      { name: '线切割费', category: 'CNC', scope: 'mold', calcType: 'qty', calcConfig: { src: '线切割长度', price: 8 } },
      { name: '抛光省模费', category: '表面处理', scope: 'mold', calcType: 'qty', calcConfig: { src: '抛光工时', price: 120 } },
      { name: '模架费', category: '模架', scope: 'mold', calcType: 'qty', calcConfig: { src: '模架规格', price: 1 } },
      { name: '试模费', category: '试模', scope: 'mold', calcType: 'qty', calcConfig: { src: '腔数', price: 2500 } },
      { name: '设计费', category: '自定义', scope: 'mold', calcType: 'fixed', calcConfig: { amount: 5000 } },
      { name: '模具结构费', category: '自定义', scope: 'mold', calcType: 'fixed', calcConfig: { amount: 8000 } },
      { name: '标准件费', category: '标准件', scope: 'mold', calcType: 'manual' },
      { name: '表面处理费', category: '表面处理', scope: 'mold', calcType: 'manual' },
      { name: '运输费', category: '运输', scope: 'mold', calcType: 'formula', expression: FREIGHT_EXPR },
      { name: '运输附加费', category: '运输', scope: 'mold', calcType: 'manual' },
      // —— 按件费用 ——
      { name: '橡胶材料费', category: '硫化材料', scope: 'injection', calcType: 'weight', perUnit: true,
        calcConfig: { wVar: '单件重量', priceVar: '橡胶单价', loss: 0.08, lossVar: '橡胶损耗率' } },
      { name: '硫化加工费', category: '硫化加工', scope: 'injection', calcType: 'formula', perUnit: true,
        expression: '机台时薪 * 硫化周期 / 3600 / 腔数' },
      { name: '去飞边费', category: '后加工', scope: 'injection', calcType: 'manual', perUnit: true },
      { name: '模具分摊费', category: '模具分摊', scope: 'injection', calcType: 'manual', perUnit: true },
      { name: '包装费', category: '硫化包装', scope: 'injection', calcType: 'fixed', perUnit: true,
        calcConfig: { amount: 0.05 } },
    ],
  },
];
