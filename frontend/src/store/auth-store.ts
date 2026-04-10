import { create } from 'zustand';

export interface AuthState {
  apiKey: string | null;
  setApiKey: (key: string) => void;
  clearApiKey: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  apiKey:
    typeof window !== 'undefined'
      ? localStorage.getItem('dashboard_api_key')
      : null,

  setApiKey: (key: string) => {
    localStorage.setItem('dashboard_api_key', key);
    set({ apiKey: key });
  },

  clearApiKey: () => {
    localStorage.removeItem('dashboard_api_key');
    set({ apiKey: null });
  },
}));
