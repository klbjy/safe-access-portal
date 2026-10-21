import { LogOut, ShieldCheck } from "lucide-react";
import type { UserSummary } from "../config/types";

export function AppHeader({ user, onLogout }: { user: UserSummary; onLogout: () => void }) {
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <div className="app-brand"><span className="app-brand__mark" aria-hidden="true"><ShieldCheck size={21} /></span><span>保险箱访问</span></div>
        <div className="account-strip">
          <div className="account-strip__identity"><strong>{user.name}</strong><span>{user.role === "admin" ? "管理者" : "志愿者"}</span></div>
          <button className="button button--quiet" type="button" onClick={onLogout}><LogOut aria-hidden="true" size={17} /><span>退出</span></button>
        </div>
      </div>
    </header>
  );
}
