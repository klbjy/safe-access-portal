import { Check, Clipboard, KeyRound, RefreshCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { apiRequest, errorMessage, isSessionError } from "../api";

interface VaultPanelProps {
  onSessionExpired: () => void;
  action?: ReactNode;
  refreshKey?: number;
}

export function VaultPanel({ onSessionExpired, action, refreshKey = 0 }: VaultPanelProps) {
  const [password, setPassword] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    setPassword("");
    try {
      const result = await apiRequest<{ password: string; updatedAt: string }>("/api/vault");
      setPassword(result.password);
      setUpdatedAt(result.updatedAt);
    } catch (caught) {
      if (isSessionError(caught)) return onSessionExpired();
      setError(errorMessage(caught, "暂时无法获取密码"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [refreshKey]);

  async function copy() {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("无法自动复制，请手动输入");
    }
  }

  return (
    <section className="vault-panel" aria-labelledby="vault-title">
      <div className="section-heading">
        <div>
          <h2 id="vault-title">当前保险箱密码</h2>
          <p>{updatedAt ? `最近更新：${new Date(updatedAt).toLocaleString("zh-CN")}` : "登录状态已核验"}</p>
        </div>
        {action}
      </div>

      {loading ? (
        <div className="vault-state" aria-live="polite"><span className="spinner" />正在安全读取…</div>
      ) : error ? (
        <div className="vault-state vault-state--error" role="alert">
          <span>{error}</span>
          <button className="button button--secondary" type="button" onClick={() => void load()}>
            <RefreshCw aria-hidden="true" size={17} />重试
          </button>
        </div>
      ) : (
        <div className="password-stage">
          <div className="password-stage__icon" aria-hidden="true"><KeyRound size={25} /></div>
          <output className="password-value" aria-label="当前保险箱密码">{password}</output>
          <button className={`copy-button ${copied ? "copy-button--done" : ""}`} type="button" onClick={() => void copy()}>
            {copied ? <Check aria-hidden="true" size={20} /> : <Clipboard aria-hidden="true" size={20} />}
            <span>{copied ? "已复制" : "复制密码"}</span>
          </button>
        </div>
      )}
    </section>
  );
}
