import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { UserSummary } from "../../shared/api";
import { ApiClientError, apiRequest, errorMessage } from "../api";

interface LoginPageProps {
  onLogin: (user: UserSummary) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
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
    if (Object.keys(nextErrors).length > 0) return;

    setPending(true);
    try {
      const result = await apiRequest<{ user: UserSummary }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ name, studentId }),
      });
      onLogin(result.user);
    } catch (caught) {
      if (caught instanceof ApiClientError) setFieldErrors(caught.fieldErrors ?? {});
      setError(errorMessage(caught, "暂时无法登录，请重试"));
      setStudentId("");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true">
          <ShieldCheck size={26} strokeWidth={2} />
        </div>
        <div className="login-heading">
          <h1 id="login-title">保险箱访问</h1>
          <p>仅限已授权人员</p>
        </div>

        <form className="login-form" onSubmit={submit} noValidate>
          <label className="field">
            <span>姓名</span>
            <input
              autoComplete="name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? "name-error" : undefined}
              placeholder="请输入姓名"
            />
            {fieldErrors.name ? <small id="name-error" className="field-error">{fieldErrors.name}</small> : null}
          </label>
          <label className="field">
            <span>学号</span>
            <input
              autoComplete="off"
              inputMode="text"
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
              aria-invalid={Boolean(fieldErrors.studentId)}
              aria-describedby={fieldErrors.studentId ? "student-error" : undefined}
              placeholder="请输入学号"
            />
            {fieldErrors.studentId ? (
              <small id="student-error" className="field-error">{fieldErrors.studentId}</small>
            ) : null}
          </label>
          {error ? <div className="inline-alert inline-alert--error" role="alert">{error}</div> : null}
          <button className="button button--primary login-submit" type="submit" disabled={pending}>
            <span>{pending ? "正在核验…" : "核验身份"}</span>
            {!pending ? <ArrowRight aria-hidden="true" size={19} /> : null}
          </button>
        </form>

        <div className="privacy-note">
          <LockKeyhole aria-hidden="true" size={17} />
          <span>系统仅核验姓名与学号，不会要求设置个人密码。</span>
        </div>
      </section>
    </main>
  );
}
