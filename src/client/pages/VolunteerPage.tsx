import type { UnlockedSession } from "../config/types";
import { AppHeader } from "../components/AppHeader";
import { VaultPanel } from "../components/VaultPanel";

export function VolunteerPage({ session, onLogout }: { session: UnlockedSession; onLogout: () => void }) {
  return (
    <div className="app-shell page-enter">
      <AppHeader user={session.user} onLogout={onLogout} />
      <main className="content content--narrow">
        <div className="page-intro"><h1>欢迎，{session.user.name}</h1><p>已解锁当前发布配置。</p></div>
        <VaultPanel password={session.password} configVersion={session.configVersion} />
        <p className="page-footnote">请仅在需要开启保险箱时使用，并注意周围环境。</p>
      </main>
    </div>
  );
}
