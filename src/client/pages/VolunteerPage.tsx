import type { UserSummary } from "../../shared/api";
import { AppHeader } from "../components/AppHeader";
import { VaultPanel } from "../components/VaultPanel";

export function VolunteerPage({ user, onLogout }: { user: UserSummary; onLogout: () => void }) {
  return (
    <div className="app-shell page-enter">
      <AppHeader user={user} onLogout={onLogout} />
      <main className="content content--narrow">
        <div className="page-intro">
          <h1>欢迎，{user.name}</h1>
          <p>你的身份已通过授权名单核验。</p>
        </div>
        <VaultPanel onSessionExpired={onLogout} />
        <p className="page-footnote">请仅在需要开启保险箱时使用，并注意周围环境。</p>
      </main>
    </div>
  );
}
