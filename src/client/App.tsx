import { useCallback, useEffect, useState } from "react";
import { parseSiteConfig } from "./config/schema";
import type { SiteConfigV1, UnlockedSession } from "./config/types";
import { AdminPage } from "./pages/AdminPage";
import { LoginPage } from "./pages/LoginPage";
import { VolunteerPage } from "./pages/VolunteerPage";

export function App() {
  const [config, setConfig] = useState<SiteConfigV1 | null>(null);
  const [session, setSession] = useState<UnlockedSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}site-config.json?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("配置请求失败");
      setConfig(parseSiteConfig(await response.json()));
    } catch {
      setConfig(null);
      setLoadError("站点配置暂时无法加载，请检查网络后重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    const route = session ? (session.user.role === "admin" ? "/admin" : "/volunteer") : "/";
    if (window.location.hash !== `#${route}`) window.history.replaceState(null, "", `#${route}`);
  }, [session]);

  function logout() {
    setSession(null);
  }

  if (loading) {
    return <main className="boot-screen" aria-live="polite"><span className="spinner" />正在读取站点配置…</main>;
  }
  if (!config || loadError) return <LoginPage config={null} loadError={loadError} onRetry={() => void loadConfig()} onLogin={setSession} />;
  if (!session) return <LoginPage config={config} onRetry={() => void loadConfig()} onLogin={setSession} />;
  if (session.user.role === "admin") return <AdminPage session={session} onLogout={logout} />;
  return <VolunteerPage session={session} onLogout={logout} />;
}
