import { ArrowRight, RefreshCw, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { unlockSiteConfig } from "../config/siteConfig";
import type { SiteConfigV1, UnlockedSession } from "../config/types";

interface LoginPageProps {
  config: SiteConfigV1 | null;
  loadError?: string;
  onRetry: () => void;
  onLogin: (session: UnlockedSession) => void;
}

export function LoginPage({ config, loadError = "", onRetry, onLogin }: LoginPageProps) {
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!name.trim()) nextErrors.name = "请输入姓名";
    if (!studentId.trim()) nextErrors.studentId = "请输入学号";
    setFieldErrors(nextErrors);
    setError("");
    if (Object.keys(nextErrors).length > 0 || !config) return;

    setPending(true);
    try {
      onLogin(await unlockSiteConfig(config, name, studentId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "姓名或学号不正确，或尚未获得权限");
      setStudentId("");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true"><ShieldCheck size={26} strokeWidth={2} /></div>
        <div className="login-heading"><h1 id="login-title">保险箱访问</h1><p>仅限已配置人员</p></div>

        {loadError ? (
          <div className="config-error" role="alert">
            <p>{loadError}</p>
            <button className="button button--secondary" type="button" onClick={onRetry}>
              <RefreshCw aria-hidden="true" size={17} />重新读取
            </button>
          </div>
        ) : (
          <form className="login-form" onSubmit={submit} noValidate>
            <label className="field">
              <span>姓名</span>
              <input autoComplete="name" autoFocus value={name} onChange={(event) => setName(event.target.value)} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? "name-error" : undefined} placeholder="请输入姓名" />
              {fieldErrors.name ? <small id="name-error" className="field-error">{fieldErrors.name}</small> : null}
            </label>
            <label className="field">
              <span>学号</span>
              <input autoComplete="off" inputMode="text" value={studentId} onChange={(event) => setStudentId(event.target.value)} aria-invalid={Boolean(fieldErrors.studentId)} aria-describedby={fieldErrors.studentId ? "student-error" : undefined} placeholder="请输入学号" />
              {fieldErrors.studentId ? <small id="student-error" className="field-error">{fieldErrors.studentId}</small> : null}
            </label>
            {error ? <div className="inline-alert inline-alert--error" role="alert">{error}</div> : null}
            <button className="button button--primary login-submit" type="submit" disabled={pending}>
              <span>{pending ? "正在核验…" : "核验身份"}</span>
              {!pending ? <ArrowRight aria-hidden="true" size={19} /> : null}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
