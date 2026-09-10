// API 客户端

import axios from 'axios';

const token = () => localStorage.getItem('mqs_token');

export const api = axios.create({
  baseURL: '/api',
});

api.interceptors.request.use((config) => {
  const t = token();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('mqs_token');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  },
);

// 客户分享（免登录，凭 token）
export const share = {
  get: (token: string) => api.get(`/share/${token}`).then((r) => r.data),
  // 显式传空对象：Fastify 不接受「声明 JSON 但 body 为空」的请求
  confirm: (token: string) => api.post(`/share/${token}/confirm`, {}).then((r) => r.data),
};

// 后台管理（仅管理员，后端会再校验 role）
export const admin = {
  overview: () => api.get('/admin/overview').then((r) => r.data),
  users: () => api.get('/admin/users').then((r) => r.data),
};

// 认证
export const auth = {
  login: (email: string, password: string) => api.post('/auth/login', { email, password }).then((r) => r.data),

  register: (data: {
    email: string;
    password: string;
    name: string;
    code: string;
    companyName?: string;
  }) => api.post('/auth/register', data).then((r) => r.data),

  // 发送邮箱验证码：scene = 'register' | 'reset_password'
  sendCode: (email: string, scene: 'register' | 'reset_password') =>
    api.post('/auth/send-code', { email, scene }).then((r) => r.data),

  // 找回密码：邮箱 + 验证码 + 新密码
  resetPassword: (email: string, code: string, password: string) =>
    api.post('/auth/reset-password', { email, code, password }).then((r) => r.data),

  me: () => api.get('/auth/me').then((r) => r.data),
};

// 报价单
export const quotes = {
  list: (params?: any) => api.get('/quotes', { params }).then((r) => r.data),
  get: (id: string) => api.get(`/quotes/${id}`).then((r) => r.data),
  // 创建（支持 customerEmail 自动直发）
  create: (body: {
    customerId?: string;
    customerName: string;
    customerEmail?: string;
    input: any;
  }) => api.post('/quotes', body).then((r) => r.data),

  // 按配置中心创建报价单
  createConfigured: (body: {
    moldTypeId: string;
    customerName: string;
    customerEmail?: string;
    productName?: string;
    values: Record<string, any>;
    manualAmounts?: Record<string, number>;
  }) => api.post('/quotes/configured', body).then((r) => r.data),

  update: (id: string, versionNo: string, body: any) =>
    api.patch(`/quotes/${id}/versions/${versionNo}`, body).then((r) => r.data),

  // 发送：生成分享链接 + 邮件通知客户（sendEmail 默认 true）
  send: (id: string, email: string, sendEmail = true) =>
    api.post(`/quotes/${id}/send`, { email, sendEmail }).then((r) => r.data),

  // 重发报价单邮件（不改状态）
  resendEmail: (id: string, email: string) =>
    api.post(`/quotes/${id}/resend-email`, { email }).then((r) => r.data),

  // 邮件发送记录
  emailLogs: (id: string) => api.get(`/quotes/${id}/email-logs`).then((r) => r.data),

  // 复制历史报价生成新报价（原报价不变）
  duplicate: (id: string) => api.post(`/quotes/${id}/duplicate`).then((r) => r.data),

  // 人工调整留痕
  adjust: (id: string, body: { field: string; adjustedValue: number; systemValue?: number; reason?: string }) =>
    api.post(`/quotes/${id}/adjust`, body).then((r) => r.data),
  adjustments: (id: string) => api.get(`/quotes/${id}/adjustments`).then((r) => r.data),

  // 状态流转：成交 / 未成交 / 作废
  setStatus: (id: string, status: string, note?: string) =>
    api.patch(`/quotes/${id}/status`, { status, note }).then((r) => r.data),

  // 版本历史
  versions: (id: string) => api.get(`/quotes/${id}/versions`).then((r) => r.data),

  // 导出 Excel（返回 Blob）
  exportExcel: async (id: string): Promise<void> => {
    const resp = await api.get(`/quotes/${id}/export-excel`, {
      responseType: 'blob',
    });
    const blob = new Blob([resp.data], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const disposition = resp.headers['content-disposition'] || '';
    const m = /filename="?([^"]+)"?/.exec(disposition as string);
    a.download = m ? decodeURIComponent(m[1]) : `quote_${id}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};

// 计算
export const calc = {
  quote: (body: any) => api.post('/calc/quote', body).then((r) => r.data),
  cavity: (input: any) => api.post('/calc/optimal-cavity', { input }).then((r) => r.data),
};

// 客户
export const customers = {
  list: (keyword?: string) =>
    api.get('/customers', { params: { keyword } }).then((r) => r.data),
  get: (id: string) => api.get(`/customers/${id}`).then((r) => r.data),
  quotes: (id: string) => api.get(`/customers/${id}/quotes`).then((r) => r.data),
  create: (body: any) => api.post('/customers', body).then((r) => r.data),
  update: (id: string, body: any) =>
    api.patch(`/customers/${id}`, body).then((r) => r.data),
};

// 报价项中心（公式 / 条件 / 测试发布）
export const quoteItems = {
  list: () => api.get('/formulas').then((r) => r.data),
  variables: () => api.get('/formulas/variables').then((r) => r.data),
  test: (body: { expression: string; condition?: string; variables?: Record<string, number> }) =>
    api.post('/formulas/test', body).then((r) => r.data),
  create: (body: any) => api.post('/formulas', body).then((r) => r.data),
  update: (id: string, body: any) => api.patch(`/formulas/${id}`, body).then((r) => r.data),
  testOne: (id: string, body?: any) => api.post(`/formulas/${id}/test`, body ?? {}).then((r) => r.data),
  enable: (id: string) => api.post(`/formulas/${id}/enable`).then((r) => r.data),
  disable: (id: string) => api.post(`/formulas/${id}/disable`).then((r) => r.data),
  duplicate: (id: string) => api.post(`/formulas/${id}/duplicate`).then((r) => r.data),
  remove: (id: string) => api.delete(`/formulas/${id}`).then((r) => r.data),
};

// 材料中心
export const materials = {
  list: () => api.get('/materials').then((r) => r.data),
  seedPreset: () => api.post('/materials/seed-preset').then((r) => r.data),
  create: (body: any) => api.post('/materials', body).then((r) => r.data),
  update: (id: string, body: any) => api.patch(`/materials/${id}`, body).then((r) => r.data),
  prices: (id: string) => api.get(`/materials/${id}/prices`).then((r) => r.data),
  remove: (id: string) => api.delete(`/materials/${id}`).then((r) => r.data),
};

// 参数中心
export const parameters = {
  list: (params?: any) => api.get('/parameters', { params }).then((r) => r.data),
  create: (body: any) => api.post('/parameters', body).then((r) => r.data),
  update: (id: string, body: any) => api.patch(`/parameters/${id}`, body).then((r) => r.data),
  toggle: (id: string) => api.post(`/parameters/${id}/toggle`).then((r) => r.data),
  remove: (id: string) => api.delete(`/parameters/${id}`).then((r) => r.data),
};

// 报价模板
export const templates = {
  list: () => api.get('/templates').then((r) => r.data),
  create: (body: any) => api.post('/templates', body).then((r) => r.data),
  update: (id: string, body: any) => api.patch(`/templates/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/templates/${id}`).then((r) => r.data),
};

// 配置中心（模具类型 + 整体配置读写）
export const configApi = {
  moldTypes: () => api.get('/mold-types').then((r) => r.data),
  initPreset: () => api.post('/mold-types/init-preset').then((r) => r.data),
  createMoldType: (body: { name: string; code?: string; copyFromId?: string }) =>
    api.post('/mold-types', body).then((r) => r.data),
  updateMoldType: (id: string, body: any) => api.patch(`/mold-types/${id}`, body).then((r) => r.data),
  removeMoldType: (id: string) => api.delete(`/mold-types/${id}`).then((r) => r.data),
  get: (moldTypeId: string) => api.get(`/config/${moldTypeId}`).then((r) => r.data),
  save: (moldTypeId: string, body: any) => api.put(`/config/${moldTypeId}`, body).then((r) => r.data),
  calc: (moldTypeId: string, params?: Record<string, number>) =>
    api.post(`/config/${moldTypeId}/calc`, { params }).then((r) => r.data),
};
