import { create } from "zustand";

interface AuthState {
  token: string | null;
  user: any | null;
  setToken: (token: string, user: any) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  token: localStorage.getItem("fyers_v3_token"),
  user: JSON.parse(localStorage.getItem("fyers_v3_user") || "null"),
  setToken: (token, user) => {
    localStorage.setItem("fyers_v3_token", token);
    localStorage.setItem("fyers_v3_user", JSON.stringify(user));
    set({ token, user });
  },
  logout: () => {
    localStorage.removeItem("fyers_v3_token");
    localStorage.removeItem("fyers_v3_user");
    set({ token: null, user: null });
  },
}));
