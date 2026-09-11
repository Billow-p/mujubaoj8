// 共享类型定义 — 前后端共用

export type UserRole = 'quoter' | 'auditor' | 'admin';
export type QuoteStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'sent'
  | 'confirmed'
  | 'expired';
export type ComplexityLevel = 'simple' | 'medium' | 'complex' | 'ultra_precision';
export type MaterialKey =
  | 'ABS'
  | 'PP'
  | 'PE'
  | 'PA'
  | 'PC'
  | 'POM'
  | 'PMMA'
  | 'PBT';
export type SteelKey = 'P20' | '718H' | 'S136' | 'NAK80' | 'H13' | 'S50C';

// 单条模具费中间项的"值 + 公式 + 锁定状态"
export interface CalcItem {
  value: number;
  formula: string;
  locked: boolean;
  overridden: boolean;
}

// 11 项模具费明细
export interface MoldFeeItems {
  coreSteel: CalcItem;        // 1. 模芯钢料费
  designFee: CalcItem;        // 2. 模具设计费
  moldBase: CalcItem;         // 3. 模架费
  standardParts: CalcItem;    // 4. 标准件
  cncMachining: CalcItem;     // 5. CNC 加工
  edm: CalcItem;              // 6. EDM 电火花
  wireCutting: CalcItem;      // 7. 线切割
  polishing: CalcItem;        // 8. 省模抛光
  trialMold: CalcItem;        // 9. 试模费
  surfaceTreatment: CalcItem; // 10. 表面处理
  packagingShipping: CalcItem;// 11. 模具包装运输
}

// 5 项注塑单件成本
export interface InjectionItems {
  material: CalcItem;
  machining: CalcItem;
  postProcess: CalcItem;
  packaging: CalcItem;
  moldAmortization: CalcItem;
}

// 汇总
export interface QuoteSummary {
  moldSubtotal: number;             // 12 项模具小计
  moldExtrasTotal: number;          // 附加模具费合计
  moldManagementFee: number;       // 13 项管理费+利润
  moldTotalExVat: number;           // 14 项模具合计(不含税)
  moldVat: number;
  moldIncVat: number;
  unitCostExVat: number;            // 单件成本小计（含注塑附加项）
  injectionExtrasUnit: number;      // 注塑附加项单件合计
  injectionTotalExVat: number;      // 注塑合计 = 单件 × 数量
  injectionVat: number;
  injectionIncVat: number;
  grandTotalExVat: number;          // 总不含税
  grandTotalVat: number;            // 总税额
  grandTotalIncVat: number;         // 总含税
}

// 输入参数
export interface QuoteInput {
  // 客户信息
  customerId?: string;
  customerName: string;
  customerEmail?: string;       // 客户邮箱（提交时若非空，自动发送 + 直发）

  // 产品 + 材料
  productName: string;
  material: MaterialKey;       // 决定单价
  steel: SteelKey;             // 决定单价 + 钢材系数
  complexity: ComplexityLevel; // 决定复杂度系数
  singleWeightKg: number;
  productSize?: string;        // 300×200×80, 仅展示用
  cavityCount: number;
  surfaceTreatment?: string;

  // 注塑工艺
  machineTonnageT: number;     // 仅展示用
  cycleTimeS: number;
  efficiencyFactor: number;    // 0.8
  firstOrderQty: number;       // 首单数量
  machineRatePerHour: number;  // 130
  materialLossRate: number;    // 0.05

  // 税率
  vatRate: number;             // 0.13
  managementRate: number;      // 0.15

  // 模芯尺寸
  coreLengthMm: number;
  coreWidthMm: number;
  coreHeightMm: number;
  steelDensity: number;        // 7.85
  steelUnitPrice: number;      // 来自钢材表

  // 后加工类型
  postProcessType: string;

  // 附加费用项（用户动态加的项，不参与引擎公式，但会进入总价）
  extras?: QuoteExtras;

  // 自由备注参数（用户加的"新参数"，仅存档展示，不参与计算）
  customParams?: Record<string, string | number | boolean>;
}

// 单条用户自定义的附加费用项
export interface ExtraItem {
  id: string;           // uuid，前端生成，保证唯一
  name: string;         // 名称，例如"运输费"、"二次加工"
  amount: number;       // 金额（元，模具费为总价，注塑为单件价）
  note?: string;        // 备注
}

// 附加费用项集合
export interface QuoteExtras {
  moldExtras: ExtraItem[];       // 加在模具费上的固定金额
  injectionExtras: ExtraItem[];  // 加在注塑单件上的单价（按首单数量乘入总价）
}

// 商务条款覆盖（每条独立开关 + 文字）
export interface BusinessTermItem {
  index: number;       // 从 1 开始
  enabled: boolean;
  text: string;
}

// 完整计算结果
export interface QuoteCalcResult {
  moldFeeItems: MoldFeeItems;
  injectionItems: InjectionItems;
  summary: QuoteSummary;
  businessTerms: BusinessTermItem[];
  // 用户自定义的附加项（连同公式来源一起返回，便于 UI 渲染）
  extras?: {
    moldExtras: { id: string; name: string; amount: number; note?: string }[];
    injectionExtras: { id: string; name: string; amount: number; note?: string }[];
  };
  // 参数中心 — 用户自定义公式的求值结果
  customFormulas?: CustomFormulaResults;
  // 用于追溯：每个分项的"输入来源"标签
  provenance: {
    complexityCoeff: number;
    steelCoeff: number;
    materialUnitPrice: number;
  };
}

// 计算请求接口（HTTP body）
export interface CalcQuoteRequest {
  input: QuoteInput;
  overrides?: Partial<Record<keyof MoldFeeItems | keyof InjectionItems, number>>;
  locks?: Array<keyof MoldFeeItems | keyof InjectionItems>;
  businessTermOverrides?: BusinessTermItem[];
  customFormulas?: CustomFormulaInput[];
}

// 自定义公式（与数据库 CustomFormula 表同结构，但更灵活）
export interface CustomFormulaInput {
  name: string;
  scope: 'mold' | 'injection' | 'summary';
  expression: string;
  enabled: boolean;
  sortOrder: number;
  note?: string;
  code?: string;      // 报价项编码，其它公式可用 {code} 引用（计算链）
  condition?: string; // 条件表达式，求值为真才计入该报价项
  category?: string;  // 报价项分类
  unit?: string;      // 单位
  version?: number;   // 报价项版本（历史报价冻结）
}

// 自定义公式求值结果（按 scope 分类）
export interface CustomFormulaResults {
  mold: { name: string; expression: string; value: number; note?: string }[];
  injection: { name: string; expression: string; value: number; note?: string }[];
  summary: { name: string; expression: string; value: number; note?: string }[];
}

// 默认商务条款模板
// ============================================================
// 材料分类（两级）—— 按模具 / 注塑行业主流分类法
//
// 一级按「用途场景」划分，二级按「材质体系」划分。
// 这两个常量只是预置建议值，用户可以自由增删材料时自行输入别的分类。
// ============================================================

/** 一级分类：按用途场景 */
export const MATERIAL_GROUPS = ['模具钢材', '塑料原料', '压铸合金', '辅助材料'] as const;

export type MaterialGroup = (typeof MATERIAL_GROUPS)[number];

/** 二级分类：按材质体系 */
export const MATERIAL_SUB_CATEGORIES: Record<string, string[]> = {
  模具钢材: ['预硬塑胶模具钢', '镜面耐腐蚀钢', '热作模具钢', '冷作模具钢'],
  塑料原料: ['通用塑料', '工程塑料', '特种工程塑料', '弹性体软胶'],
  压铸合金: ['铝合金', '锌合金', '镁合金'],
  辅助材料: ['表面处理', '包装材料', '模具辅料'],
};

/**
 * 「数量」参数的候选名，按优先级排列。
 *
 * 各模具类型对同一个概念的叫法不同：注塑数量 / 压铸数量 / 成型数量…
 * 计算引擎按这个顺序自动查找，找不到才报错。
 * 后端展示（客户库、邮件）也用它，避免两边各写一份列表走偏。
 */
export const QTY_VAR_CANDIDATES = [
  '注塑数量',
  '压铸数量',
  '成型数量',
  '订单数量',
  '本次数量',
  '生产数量',
  '首单数量',
];

export const DEFAULT_BUSINESS_TERMS: BusinessTermItem[] = [
  { index: 1, enabled: true, text: '税费：以上总价为含 13% 增值税价格，开票含税。' },
  { index: 2, enabled: true, text: '运费：广东省内运费免费；省外按实际运输方式/体积重量另行计费。' },
  { index: 3, enabled: true, text: '交期：模具 40 天；首单注塑 收到定金后 45 天。' },
  { index: 4, enabled: true, text: '付款方式：合同签订付 30% 定金，试模合格付 50%，量产交付前付清 20%。' },
  { index: 5, enabled: true, text: '质保：模具质保 50 万模次；注塑产品按国家三包标准。' },
  { index: 6, enabled: true, text: '保密：双方对产品技术资料负有保密义务。' },
  { index: 7, enabled: true, text: '验收：按 GB/T 交货，需方 7 日内提出异议。' },
  { index: 8, enabled: true, text: '争议：协商不成提交合同签订地人民法院诉讼解决。' },
];

// ============================================================
// 配置中心（计算方式驱动）— 用户选计算方式、填数字，不写公式
// ============================================================

export type MoldCalcType =
  | 'fixed'    // 固定金额
  | 'qty'      // 数量 × 单价
  | 'size'     // 长 × 宽 × 高 → 体积换重量 → × 单价
  | 'hours'    // 工时 × 时薪
  | 'weight'   // 重量 × 单价 × (1 + 损耗)
  | 'percent'  // 基数 × 百分比
  | 'manual'   // 报价时手填
  | 'formula'; // 高级：手写公式

export interface QuoteItemCalcConfig {
  amount?: number;
  src?: string;
  srcQty?: number;
  price?: number;
  l?: string;
  w?: string;
  h?: string;
  /** 固定密度（g/cm³）。未选材料时使用 */
  density?: number;
  /** 密度取自哪个参数（如「钢材密度」）；选了材料库材料时由前端注入该参数 */
  densityVar?: string;
  priceVar?: string;
  priceFixed?: number;
  hours?: number;
  rate?: number;
  wVar?: string;
  /** 固定损耗率。未选材料时使用 */
  loss?: number;
  /** 损耗率取自哪个参数（如「钢材损耗率」）；选了材料库材料时由前端注入该参数 */
  lossVar?: string;
  base?: string;
}

export interface QuoteItemDef {
  id?: string;
  name: string;
  category?: string;
  scope: 'mold' | 'injection';
  calcType: MoldCalcType;
  calcConfig?: QuoteItemCalcConfig;
  expression?: string;
  enabled: boolean;
  sortOrder?: number;
  note?: string;
  unit?: string;
  /**
   * 按件计价：算出来的结果是「单件成本」，总额 = 单件成本 × 注塑数量。
   * 仅 scope='injection' 有意义。注塑费用基本都是按件算的（如 0.3 元/件）。
   */
  perUnit?: boolean;
}

export interface ConfigCalcLine {
  name: string;
  category: string;
  scope: 'mold' | 'injection';
  calcType: MoldCalcType;
  value: number;
  expression: string;
  readable: string;
  skipped?: boolean;
  manual?: boolean;
  error?: string;
  /** 按件计价：该项结果是单件成本 */
  perUnit?: boolean;
  /** 单件成本（元/件）——注塑项才有 */
  unitPrice?: number;
  /** 数量 —— 注塑项才有 */
  qty?: number;
  /** 数量的单位，如「件」 */
  qtyUnit?: string;
}

export interface ConfigCalcResult {
  lines: ConfigCalcLine[];
  mold: number;
  injection: number;
  profitRate: number;
  profit: number;
  taxRate: number;
  tax: number;
  total: number;
  /** 本次注塑数量 */
  injectionQty?: number;
  /** 注塑单件成本合计（元/件） */
  unitCost?: number;
}

// ============================================================
// 多注塑件报价（报价单元 / 项目）
// ============================================================

/** 参数作用域：决定参数该填在哪、被谁消费 */
export type ParamScope = 'mold' | 'injection' | 'common';

/** 一套模具（或一组并列的模具） */
export interface QuoteProjectMold {
  code?: string;
  name: string;
  /** 本套模具所用钢材编码（来自材料库，自动带出单价/密度/损耗） */
  materialCode?: string;
  /** 钢材名称（后端解析后回存，便于展示） */
  materialName?: string;
  /** 模具作用域参数（模芯长/宽/高、腔数…），name → 数值 */
  params: Record<string, number>;
  /** 手动填写金额的费用项（name → 金额） */
  manualAmounts?: Record<string, number>;
}

/** 一个注塑件 */
export interface QuoteProjectPart {
  code?: string;
  name: string;
  /** 件所用材料编码（来自材料库，自动带出单价/损耗） */
  materialCode?: string;
  /** 本件数量 */
  qty: number;
  /** 注塑作用域参数（单件重量、原料单价、损耗率…） */
  params: Record<string, number>;
  manualAmounts?: Record<string, number>;
}

/** 公共参数（整单一份） */
export interface QuoteProjectCommon {
  profitRate?: number;
  taxRate?: number;
  /**
   * 模具类型的数量参数名（注塑数量 / 压铸数量 / 成型数量）。
   * 引擎把它注入到每件的计算上下文，作为 per-unit 乘法的数量。
   */
  qtyVarName?: string;
  /** 公共参数（所有模具/件共享，如 钢材单价、运费单价、运输区域） */
  params?: Record<string, number>;
}

export interface QuoteProjectInput {
  /** 完整的费用项定义（mold + injection 两种 scope） */
  items: QuoteItemDef[];
  common: QuoteProjectCommon;
  molds: QuoteProjectMold[];
  parts: QuoteProjectPart[];
}

export interface QuoteProjectMoldResult {
  code?: string;
  name: string;
  materialCode?: string;
  materialName?: string;
  subtotal: number;
  lines: ConfigCalcLine[];
}

export interface QuoteProjectPartResult {
  code?: string;
  name: string;
  materialCode?: string;
  qty: number;
  /** 单件成本（元/件） */
  unitCost: number;
  /** 本件小计（单件成本 × 数量） */
  total: number;
  lines: ConfigCalcLine[];
}

export interface QuoteProjectResult {
  kind: 'project';
  moldResults: QuoteProjectMoldResult[];
  partResults: QuoteProjectPartResult[];
  moldSubtotal: number;
  injectionSubtotal: number;
  subtotal: number;
  profitRate: number;
  profit: number;
  taxRate: number;
  tax: number;
  total: number;
}

// 计算方式的中文说明（前后端共用）
export const CALC_TYPE_META: { v: MoldCalcType; n: string; d: string }[] = [
  { v: 'fixed', n: '固定金额', d: '每次都收这么多，不会变' },
  { v: 'qty', n: '数量 × 单价', d: '按件数、穴数之类的数量乘单价' },
  { v: 'size', n: '按模具尺寸算材料', d: '长 × 宽 × 高 × 材料密度 × 单价，自动换算成重量' },
  { v: 'hours', n: '工时 × 时薪', d: '加工费常用' },
  { v: 'weight', n: '重量 × 单价', d: '按产品重量和材料单价算' },
  { v: 'percent', n: '按比例算', d: '按前面费用合计的百分比收，比如管理费 15%' },
  { v: 'manual', n: '报价时手填', d: '每次报价临时定，不预设算法' },
  { v: 'formula', n: '高级：自己写公式', d: '只有特殊算法才需要用到' },
];
