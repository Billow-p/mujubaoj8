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
