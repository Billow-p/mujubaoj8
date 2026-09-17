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
    { id: 'p5', name: '运输区域', scope: 'common', type: 'number', unit: '', group: '运输', defaultValue: 1, enabled: true },
    { id: 'p6', name: '腔数', scope: 'mold', type: 'number', unit: '穴', group: '模具', defaultValue: 2, enabled: true },
    { id: 'p7', name: '模芯长', scope: 'mold', type: 'number', unit: 'mm', group: '模具', defaultValue: 500, enabled: true },
    { id: 'p8', name: '单件重量', scope: 'injection', type: 'number', unit: 'kg', group: '注塑', defaultValue: 0.18, enabled: true },
    { id: 'p9', name: '注塑数量', scope: 'injection', type: 'number', unit: '件', group: '注塑', defaultValue: 5000, enabled: true },
  ],
  items: [],
};

export const configApi = {
  moldTypes: async () => [MOLD_TYPE],
  get: async () => CFG,
  save: async () => ({}),
};

export const materials = {
  list: async () => [],
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
