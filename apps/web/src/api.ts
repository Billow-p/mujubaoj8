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
  list: () => api.get('/customers').then((r) => r.data),
  get: (id: string) => api.get(`/customers/${id}`).then((r) => r.data),
  create: (body: any) => api.post('/customers', body).then((r) => r.data),
};
