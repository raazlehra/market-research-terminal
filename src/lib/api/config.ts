export const DEFAULT_API_BASE_URL = "http://localhost:8000";

export const SYSTEM_ENDPOINTS = {
  health: "http://127.0.0.1:8000/api/health",
  docs: "http://127.0.0.1:8000/docs",
  loginUrl: `${DEFAULT_API_BASE_URL}/api/auth/login-url`,
} as const;
