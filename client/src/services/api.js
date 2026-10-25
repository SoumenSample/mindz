import axios from "axios";

// Base URL resolution:
// 1. Explicit override via REACT_APP_API_URL (unchanged behavior).
// 2. Otherwise same host as the opened page + API port. This keeps
//    localhost working AND makes LAN / port-forward access work with
//    zero rebuilds (localhost:3000 -> localhost:5000,
//    192.168.x.x:3000 -> 192.168.x.x:5000). CRA embeds env vars at
//    build time, but window.location is runtime — so one build works
//    on every network.
function resolveBaseUrl() {
  if (process.env.REACT_APP_API_URL) return process.env.REACT_APP_API_URL;
  const port = process.env.REACT_APP_API_PORT || "5000";
  if (typeof window !== "undefined" && window.location && window.location.hostname) {
    return `http://${window.location.hostname}:${port}/api`;
  }
  return `http://localhost:${port}/api`;
}

const api = axios.create({
  baseURL: resolveBaseUrl()
});

// Attach JWT automatically (except login which has no token yet)
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Only use multipart for FormData uploads, otherwise JSON
  if (config.data instanceof FormData) {
    config.headers["Content-Type"] = "multipart/form-data";
  } else if (!config.headers["Content-Type"]) {
    config.headers["Content-Type"] = "application/json";
  }
  return config;
});

// Global 401 handling: drop dead auth state and bounce to login.
// Skips the login call itself (a 401 there is just "wrong credentials")
// and skips when already on /login, so no redirect loop is possible.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url || "";
    if (status === 401 && !url.includes("/auth/login")) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      if (window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    }
    return Promise.reject(error);
  }
);

export default api;
