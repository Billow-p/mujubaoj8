// API 客户端

import axios from 'axios';

const token = () => localStorage.getItem('mqs_token');

/**
 * 件图 —— 挂在模具 / 注塑件上的那张图。
 * url 是相对路径（如 /uploads/ab12.png），直接当 <img src> 用。
 */
export interface QuoteImage {
  url: string;
  name?: string;
  /** 来源：手工上传 / 3D 渲染截图 / Excel 内嵌图 */
  source?: 'upload' | 'render3d' | 'excel';
  uploadedAt?: string;
}

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

// 平台管理（SaaS 运营方超管，跨租户）
export const platform = {
  overview: () => api.get('/platform/overview').then((r) => r.data),
  users: (params?: { keyword?: string; companyId?: string; role?: string; page?: number; pageSize?: number }) =>
    api.get('/platform/users', { params }).then((r) => r.data),
  companies: (params?: { keyword?: string }) =>
    api.get('/platform/companies', { params }).then((r) => r.data),
  updateUser: (
    id: string,
    body: { role?: string; isSuperAdmin?: boolean; extendDays?: number; expiresAt?: string | null },
  ) => api.patch(`/platform/users/${id}`, body).then((r) => r.data),
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

  // 按配置中心创建报价单（单套模具 / 旧流程）
  createConfigured: (body: {
    moldTypeId: string;
    customerName: string;
    customerEmail?: string;
    productName?: string;
    values: Record<string, any>;
    manualAmounts?: Record<string, number>;
  }) => api.post('/quotes/configured', body).then((r) => r.data),

  // 多注塑件报价（报价项目）：多套模具 + 多个注塑件
  createProject: (body: {
    moldTypeId: string;
    customerName: string;
    customerPhone?: string;
    productName?: string;
    /** 附加费用项（模具钢材 / 注塑件 / 其他费用 三个板块各自动态增删） */
    extras?: {
      moldExtras?: { id?: string; name: string; amount: number; note?: string }[];
      injectionExtras?: { id?: string; name: string; amount: number; note?: string }[];
      otherExtras?: { id?: string; name: string; amount: number; note?: string }[];
    };
    common: {
      profitRate?: number;
      taxRate?: number;
      qtyVarName?: string;
      params: Record<string, any>;
      /** 「不纳入计算」的公共参数名 */
      off?: Record<string, boolean>;
    };
    molds: {
      code?: string;
      name: string;
      /** 本套模具所用钢材编码（来自材料库） */
      materialCode?: string;
      params: Record<string, any>;
      manualAmounts?: Record<string, number>;
      /** 「不纳入计算」的参数/手填项名 */
      off?: Record<string, boolean>;
      /** 件图（上传的图纸 / 3D 渲染图），会一起导出到 Excel 报价单 */
      image?: QuoteImage | null;
    }[];
    parts: {
      code?: string;
      name: string;
      materialCode?: string;
      qty: number;
      params: Record<string, any>;
      manualAmounts?: Record<string, number>;
      /** 「不纳入计算」的参数/手填项名 */
      off?: Record<string, boolean>;
      /** 件图（同 molds[].image） */
      image?: QuoteImage | null;
    }[];
  }) => api.post('/quotes/project', body).then((r) => r.data),

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
  //
  // 返回值带上件图告警：后端的 `X-Image-Warnings` 说明有几张图没能写进报价单
  // （WEBP / 文件丢失 / 读写失败）。以前这类问题在服务端被静默吞掉，
  // 用户的体验就是「我明明传了图，导出的 Excel 里没有」却完全不知道原因。
  exportExcel: async (id: string): Promise<{ imageWarnings: string[] }> => {
    let resp;
    try {
      resp = await api.get(`/quotes/${id}/export-excel`, {
        responseType: 'blob',
        // 不让 axios 因 4xx/5xx 抛错，好让我们自己把 Blob 里的错误信息读出来
        validateStatus: () => true,
      });
    } catch (e: any) {
      // 网络层失败（断网 / 跨域被拦 / 超时）
      throw new Error(e?.message || '网络请求失败');
    }

    // 出错时后端返回的是 JSON，但 responseType:'blob' 会把它包成 Blob ——
    // 直接读 data.error 永远是 undefined，用户只能看到「导出失败：undefined」。
    // 这里先把 Blob 还原成文本再判断。
    if (resp.status >= 400) {
      let msg = `导出失败（HTTP ${resp.status}）`;
      try {
        const text = resp.data instanceof Blob ? await resp.data.text() : String(resp.data);
        const j = JSON.parse(text);
        if (j?.error) msg = j.error;
      } catch {
        /* 解析不出来就用兜底文案 */
      }
      throw new Error(msg);
    }

    const blob = new Blob([resp.data], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    // 200 但内容不是 xlsx（例如后端异常返回了 JSON）—— 提前拦下，
    // 不然会下载到一个打不开的「假 Excel」，用户以为是导出坏了。
    if (blob.size === 0) throw new Error('导出内容为空，请重试');

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // content-disposition 需要后端 CORS expose 才读得到；读不到就退回通用名，
    // 不再依赖它 —— 文件名不对是小事，下载不下来才是大事。
    const disposition = (resp.headers['content-disposition'] as string) || '';
    let filename = `报价单_${id}.xlsx`;
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    if (m) {
      try {
        filename = decodeURIComponent(m[1]);
      } catch {
        filename = m[1];
      }
    }
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 立刻 revoke 会让部分浏览器来不及取数据（下载变成 0 字节），延后释放
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    // 件图告警：单据照常下载了，但得告诉用户哪几张图没进去
    const warnCount = Number(resp.headers['x-image-warnings'] || 0);
    const imageWarnings: string[] = [];
    if (warnCount > 0) {
      const raw = (resp.headers['x-image-warning-text'] as string) || '';
      let text = '';
      try {
        text = raw ? decodeURIComponent(raw) : '';
      } catch {
        text = raw;
      }
      imageWarnings.push(
        text ||
          `有 ${warnCount} 张件图没能写进报价单（格式不支持或文件已丢失），请重新上传 PNG / JPG 后再导出`,
      );
    }
    return { imageWarnings };
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

  // 一键导出全部客户数据（Sheet1 报价明细 + Sheet2 客户汇总）
  // 与 exportExcel 同一套下载链路，坑也一样：blob 会把错误响应体吞掉、
  // 文件名头要 CORS expose 才读得到 —— 这里保持一致的加固。
  exportAll: async (): Promise<void> => {
    let resp;
    try {
      resp = await api.get('/customers/export-all', {
        responseType: 'blob',
        validateStatus: () => true,
      });
    } catch (e: any) {
      throw new Error(e?.message || '网络请求失败');
    }

    if (resp.status >= 400) {
      let msg = `导出失败（HTTP ${resp.status}）`;
      try {
        const text = resp.data instanceof Blob ? await resp.data.text() : String(resp.data);
        const j = JSON.parse(text);
        if (j?.error) msg = j.error;
      } catch {
        /* 解析不出来就用兜底文案 */
      }
      throw new Error(msg);
    }

    const blob = new Blob([resp.data], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    if (blob.size === 0) throw new Error('导出内容为空，请重试');

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const disposition = (resp.headers['content-disposition'] as string) || '';
    let filename = '客户数据.xlsx';
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    if (m) {
      try {
        filename = decodeURIComponent(m[1]);
      } catch {
        filename = m[1];
      }
    }
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
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
/**
 * 件图上传（一期）。
 * 上传返回 { url, name, size, mime }，把 url 挂到模具 / 注塑件上即可。
 */
export const uploads = {
  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api
      .post('/uploads', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      .then((r) => r.data as QuoteImage & { size: number; mime: string });
  },
  remove: (url: string) =>
    api.delete('/uploads', { params: { url } }).then((r) => r.data as { ok: boolean }),
  /** 从 Excel 询价单里抠出内嵌图片（二期） */
  extractExcel: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api
      .post('/uploads/excel', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
      })
      .then((r) => r.data as ExcelImagesResult);
  },
  /** 三期：Excel 参数表 → 报价参数（列映射） */
  importParams: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api
      .post('/uploads/excel-params', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
      })
      .then((r) => r.data as any);
  },
  /** 从 Word 询价单里抠出内嵌图片 */
  extractWord: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api
      .post('/uploads/word', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
      })
      .then((r) => r.data as WordImagesResult);
  },
  /** 上报一条识别日志（让服务端也知道前端这边发生了什么） */
  logRecog: (body: {
    kind: string;
    fileName: string;
    fileSize: number;
    outcome: 'ok' | 'empty' | 'unsupported' | 'failed';
    extracted?: number;
    reason?: string;
    detail?: string;
    step?: string;
  }) => api.post('/uploads/recog-log', body).then((r) => r.data).catch(() => ({ ok: false })),
};

/** Excel 内嵌图提取结果 */
export interface ExcelImageItem {
  id: number;
  sheetName: string;
  row: number;
  col: number;
  name: string;
  dataUrl: string;
  rowText: string[];
  suggestedName: string;
  suggestedKind: 'mold' | 'part';
}
export interface ExcelImagesResult {
  fileName: string;
  sheets: { name: string; rowCount: number }[];
  images: ExcelImageItem[];
  skipped: number;
  notes: string[];
}

/** Word 内嵌图提取结果 */
export interface WordImageItem {
  id: number;
  para: number;
  name: string;
  dataUrl: string;
  paraText: string[];
  altText: string;
  suggestedName: string;
  suggestedKind: 'mold' | 'part';
}
export interface WordImagesResult {
  fileName: string;
  paraCount: number;
  images: WordImageItem[];
  skipped: number;
  notes: string[];
}

export const materials = {
  list: () => api.get('/materials').then((r) => r.data),
  // moldTypeCodes 传空数组/不传 = 全部同步；传编码数组 = 只同步该类型相关材料
  seedPreset: (moldTypeCodes?: string[]) =>
    api.post('/materials/seed-preset', moldTypeCodes && moldTypeCodes.length ? { moldTypeCodes } : {}).then((r) => r.data),
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
  // code 传空 = 全部类型（统一同步）；传编码 = 只同步这一套（补缺失 + 从材料库补空价）
  initPreset: (body?: { code?: string; syncPrices?: boolean }) =>
    api.post('/mold-types/init-preset', body ?? {}).then((r) => r.data),
  createMoldType: (body: { name: string; code?: string; copyFromId?: string }) =>
    api.post('/mold-types', body).then((r) => r.data),
  updateMoldType: (id: string, body: any) => api.patch(`/mold-types/${id}`, body).then((r) => r.data),
  removeMoldType: (id: string) => api.delete(`/mold-types/${id}`).then((r) => r.data),
  get: (moldTypeId: string) => api.get(`/config/${moldTypeId}`).then((r) => r.data),
  save: (moldTypeId: string, body: any) => api.put(`/config/${moldTypeId}`, body).then((r) => r.data),
  calc: (moldTypeId: string, params?: Record<string, number>) =>
    api.post(`/config/${moldTypeId}/calc`, { params }).then((r) => r.data),
};
