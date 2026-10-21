import { Check, Clipboard, KeyRound } from "lucide-react";
import { useState, type ReactNode } from "react";

interface VaultPanelProps {
  password: string;
  configVersion: string;
  action?: ReactNode;
}

export function VaultPanel({ password, configVersion, action }: VaultPanelProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setError("");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("无法自动复制，请手动输入");
    }
  }

  return (
    <section className="vault-panel" aria-labelledby="vault-title">
      <div className="section-heading">
        <div><h2 id="vault-title">当前保险箱密码</h2><p>配置版本：<span className="tabular">{configVersion}</span></p></div>
        {action}
      </div>
      <div className="password-stage">
        <div className="password-stage__icon" aria-hidden="true"><KeyRound size={25} /></div>
        <output className="password-value" aria-label="当前保险箱密码">{password}</output>
        <button className={`copy-button ${copied ? "copy-button--done" : ""}`} type="button" onClick={() => void copy()}>
          {copied ? <Check aria-hidden="true" size={20} /> : <Clipboard aria-hidden="true" size={20} />}
          <span>{copied ? "已复制" : "复制密码"}</span>
        </button>
        {error ? <p className="copy-error" role="alert">{error}</p> : null}
      </div>
    </section>
  );
}
