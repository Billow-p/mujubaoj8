// Zustand store - 认证状态

import { create } from 'zustand';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'quoter' | 'auditor' | 'admin';
  companyId: string;
  /** 平台超管：可见「平台管理」（跨租户用户/公司） */
  isSuperAdmin?: boolean;
}

interface AuthState {
  user: User | null;
  setUser: (u: User | null) => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  setUser: (u) => set({ user: u }),
}));
