// Zustand store - 认证状态

import { create } from 'zustand';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'quoter' | 'auditor' | 'admin';
  companyId: string;
}

interface AuthState {
  user: User | null;
  setUser: (u: User | null) => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  setUser: (u) => set({ user: u }),
}));
