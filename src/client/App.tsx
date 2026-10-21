import { useEffect, useState } from "react";
import type { UserSummary } from "../shared/api";
import { apiRequest } from "./api";
import { LoginPage } from "./pages/LoginPage";
import { VolunteerPage } from "./pages/VolunteerPage";
import { AdminPage } from "./pages/AdminPage";

export function App() {
  const [user, setUser] = useState<UserSummary | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    apiRequest<{ user: UserSummary }>("/api/session")
      .then((result) => setUser(result.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    const path = user ? (user.role === "admin" ? "/admin" : "/volunteer") : "/";
    if (window.location.pathname !== path) window.history.replaceState(null, "", path);
  }, [ready, user]);

  function logout() {
    setUser(null);
    void apiRequest<void>("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  }

  if (!ready) {
    return (
      <main className="boot-screen" aria-live="polite">
        <span className="spinner" />正在检查登录状态…
      </main>
    );
  }
  if (!user) return <LoginPage onLogin={setUser} />;
  if (user.role === "admin") return <AdminPage user={user} onLogout={logout} />;
  return <VolunteerPage user={user} onLogout={logout} />;
}
