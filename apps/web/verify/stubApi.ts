/**
 * 仅用于 verify/ 下的 jsdom 渲染验证：把所有后端接口换成固定假数据。
 * 不参与生产打包（只在 esbuild 打包测试 harness 时替换 ../api）。
 */

export const MOLD_TYPE = {
  id: 'mt1',
  name: '注塑模具',
  code: 'injection',
  profitRate: 0.1,
  taxRate: 0.13,
};

/** 一份够用的配置中心快照：运输 5 项 + 模具 2 项 + 注塑 2 项 */
export const CFG = {
  moldType: MOLD_TYPE,
  parameters: [
    { id: 'p1', name: '运输箱长', scope: 'common', type: 'number', unit: 'cm', group: '运输', defaultValue: 120, enabled: true },
    { id: 'p2', name: '运输箱宽', scope: 'common', type: 'number', unit: 'cm', group: '运输', defaultValue: 100, enabled: true },
    { id: 'p3', name: '运输箱高', scope: 'common', type: 'number', unit: 'cm', group: '运输', defaultValue: 80, enabled: true },
    { id: 'p4', name: '运费单价', scope: 'common', type: 'number', unit: '元/kg', group: '运输', defaultValue: 1.2, enabled: true },
    {
      id: 'p5',
      name: '运输区域',
      scope: 'common',
      type: 'select',
      unit: '',
      group: '运输',
      defaultValue: '0',
      enabled: true,
      options: [
        { label: '广东省内（免运费）', value: 0 },
        { label: '广东省外（按正常运费）', value: 1 },
        { label: '偏远地区（运费加倍）', value: 2 },
      ],
    },
    { id: 'p6', name: '腔数', scope: 'mold', type: 'number', unit: '穴', group: '模具', defaultValue: 2, enabled: true },
    { id: 'p7', name: '模芯长', scope: 'mold', type: 'number', unit: 'mm', group: '模具', defaultValue: 500, enabled: true },
    { id: 'p8', name: '单件重量', scope: 'injection', type: 'number', unit: 'kg', group: '注塑', defaultValue: 0.18, enabled: true },
    { id: 'p9', name: '注塑数量', scope: 'injection', type: 'number', unit: '件', group: '注塑', defaultValue: 5000, enabled: true },
    /**
     * 价/系数类参数照旧留在产品数据分组里（材料 / 注塑），
     * 不单独成组 —— 它们与「量」参数混排是既定设计。
     * 放两条在 stub 里，让 jsdom 能验证「价类参数确实在产品数据里露脸」。
     */
    { id: 'p10', name: '钢材单价', scope: 'mold', type: 'number', unit: '元/kg', group: '材料', defaultValue: 25, enabled: true, materialCode: 'P20' },
    { id: 'p11', name: '机台时薪', scope: 'injection', type: 'number', unit: '元/时', group: '注塑', defaultValue: 130, enabled: true },
  ],
  /** 条款：配置中心保存时会整体回写，stub 里给一条免得 save() 里 terms 为 undefined */
  terms: [
    { id: 't1', text: '报价有效期 30 天', enabled: true },
  ],
  /**
   * 费用项：前两条是「配置中心预置」，后两条模拟用户在配置中心点「+ 加一项」新增的。
   * 报价页必须能同时体现这两类 —— 这正是「配置中心加了项，报价表看不到」的验收入口。
   */
  items: [
    { id: 'i1', name: '设计费', category: '模具', scope: 'mold', calcType: 'fixed', calcConfig: { amount: 6000 }, enabled: true, sortOrder: 0 },
    { id: 'i2', name: 'CNC加工费', category: '模具', scope: 'mold', calcType: 'qty', calcConfig: { src: '腔数', price: 400 }, enabled: true, sortOrder: 1 },
    { id: 'i3', name: '产品材料费', category: '注塑', scope: 'injection', calcType: 'qty', calcConfig: { src: '单件重量', price: 20 }, perUnit: true, enabled: true, sortOrder: 2 },
    {
      id: 'i4',
      name: '配置中心新增的模具费',
      category: '自定义',
      scope: 'mold',
      calcType: 'fixed',
      calcConfig: { amount: 500 },
      enabled: true,
      sortOrder: 3,
    },
    {
      id: 'i5',
      name: '配置中心新增的注塑费',
      category: '自定义',
      scope: 'injection',
      calcType: 'fixed',
      calcConfig: { amount: 0.2 },
      perUnit: true,
      enabled: true,
      sortOrder: 4,
    },
    // 手填金额类：报价页必须给出输入框（以前这里是死代码，根本没法填）
    {
      id: 'i6',
      name: '配置中心新增的手填费',
      category: '自定义',
      scope: 'mold',
      calcType: 'manual',
      calcConfig: {},
      enabled: true,
      sortOrder: 5,
    },
    // 金额为 0 的项：报价页要标成「未设值」，不能只是灰灰一个 ¥0
    {
      id: 'i7',
      name: '配置中心新增的零值费',
      category: '自定义',
      scope: 'mold',
      calcType: 'fixed',
      calcConfig: { amount: 0 },
      enabled: true,
      sortOrder: 6,
    },
  ],
};

/**
 * 测试用：记录 configApi.save() 收到的 payload。
 * 用来断言「配置中心保存时 scope 没丢」—— 漏传 scope 会把整批参数刷成 common，
 * 报价页的模具/注塑参数会整片消失（线上真实事故）。
 */
export const savedPayloads: any[] = [];

export const configApi = {
  moldTypes: async () => [MOLD_TYPE],
  get: async () => CFG,
  save: async (_id?: string, body?: any) => {
    savedPayloads.push(body);
    return {};
  },
};

/** 材料库：给几条能覆盖「钢材 / 塑料」两类的数据，供绑定材料下拉渲染选项。
 *  故意放一条重复 code 的 ABS —— 线上材料库确有同 code 多条的历史数据，
 *  下拉必须去重，否则会出现两个一样的选项。 */
export const MATERIALS = [
  { id: 'm1', code: 'P20', name: 'P20 预硬钢', category: '模具钢材', unit: 'kg', currentPrice: 25 },
  { id: 'm2', code: 'H13', name: 'H13 热作模具钢', category: '模具钢材', unit: 'kg', currentPrice: 38 },
  { id: 'm3', code: 'ABS', name: 'ABS', category: '塑料原料', unit: 'kg', currentPrice: 12 },
  { id: 'm3b', code: 'ABS', name: 'ABS 备用牌号', category: '塑料原料', unit: 'kg', currentPrice: 12 },
  { id: 'm4', code: 'PP', name: 'PP 聚丙烯', category: '塑料原料', unit: 'kg', currentPrice: 9.5 },
];

export const materials = {
  list: async () => MATERIALS,
  seedPreset: async () => ({}),
};

export const quotes = {
  get: async () => ({}),
  createProject: async () => ({ id: 'q1', quoteNo: 'Q-1' }),
  createConfigured: async () => ({ id: 'q1' }),
  send: async () => ({}),
};

export const uploads = {
  logRecog: async () => ({ ok: false }),
  upload: async () => ({ url: '', name: '', size: 0, mime: '' }),
  remove: async () => ({ ok: true }),
  extractExcel: async () => ({ images: [] }),
  extractWord: async () => ({ images: [] }),
  importParams: async () => ({ molds: [], parts: [], common: {}, extras: {} }),
};

export const share = { get: async () => ({}), confirm: async () => ({}) };
export const admin = { overview: async () => ({}), users: async () => [] };
export const platform = { overview: async () => ({}), users: async () => [], companies: async () => [] };
export const auth = { me: async () => ({}), login: async () => ({}), register: async () => ({}), sendCode: async () => ({}), resetPassword: async () => ({}) };
export const calc = { quote: async () => ({}), cavity: async () => ({}) };
export const customers = { list: async () => [], get: async () => ({}), quotes: async () => [], create: async () => ({}), update: async () => ({}) };
export const quoteItems = { list: async () => [], variables: async () => ({}), test: async () => ({}), create: async () => ({}), update: async () => ({}), testOne: async () => ({}), enable: async () => ({}), disable: async () => ({}), duplicate: async () => ({}), remove: async () => ({}) };
export const parameters = { list: async () => [], create: async () => ({}), update: async () => ({}), toggle: async () => ({}), remove: async () => ({}) };
export const templates = { list: async () => [], create: async () => ({}), update: async () => ({}), remove: async () => ({}) };
