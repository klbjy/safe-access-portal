import {
  CheckCircle2,
  ChevronDown,
  Download,
  FileUp,
  KeyRound,
  Search,
  Shield,
  Trash2,
  UserCog,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { PersonSummary, Role, UserSummary } from "../../shared/api";
import { apiRequest, errorMessage, isSessionError } from "../api";
import { AppHeader } from "../components/AppHeader";
import { ImportDialog } from "../components/ImportDialog";
import { Modal } from "../components/Modal";
import { VaultPanel } from "../components/VaultPanel";

interface AdminPageProps {
  user: UserSummary;
  onLogout: () => void;
}

type ConfirmAction =
  | { kind: "delete"; person: PersonSummary }
  | { kind: "batch"; ids: string[] }
  | { kind: "role"; person: PersonSummary; role: Role };

export function AdminPage({ user, onLogout }: AdminPageProps) {
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(true);
  const [peopleError, setPeopleError] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importRole, setImportRole] = useState<Role | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [vaultRefresh, setVaultRefresh] = useState(0);

  async function loadPeople() {
    setPeopleLoading(true);
    setPeopleError("");
    try {
      const result = await apiRequest<{ people: PersonSummary[] }>("/api/admin/people");
      setPeople(result.people);
      setSelected((current) => new Set([...current].filter((id) => result.people.some((person) => person.id === id))));
    } catch (caught) {
      if (isSessionError(caught)) return onLogout();
      setPeopleError(errorMessage(caught, "暂时无法加载人员"));
    } finally {
      setPeopleLoading(false);
    }
  }

  useEffect(() => {
    void loadPeople();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return people.filter((person) => {
      const matchesRole = roleFilter === "all" || person.role === roleFilter;
      const matchesQuery = !normalized
        || person.name.toLocaleLowerCase("zh-CN").includes(normalized)
        || person.studentId.includes(query.trim());
      return matchesRole && matchesQuery;
    });
  }, [people, query, roleFilter]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectVisible(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const person of filtered) checked ? next.add(person.id) : next.delete(person.id);
      return next;
    });
  }

  async function executeConfirm() {
    if (!confirm) return;
    setPending(true);
    try {
      if (confirm.kind === "delete") {
        await apiRequest(`/api/admin/people/${confirm.person.id}`, { method: "DELETE" });
        setNotice(`已移除 ${confirm.person.name}`);
      } else if (confirm.kind === "batch") {
        const result = await apiRequest<{ deleted: number }>("/api/admin/people/batch-delete", {
          method: "POST",
          body: JSON.stringify({ ids: confirm.ids }),
        });
        setNotice(`已移除 ${result.deleted} 人`);
      } else {
        await apiRequest(`/api/admin/people/${confirm.person.id}/role`, {
          method: "PATCH",
          body: JSON.stringify({ role: confirm.role }),
        });
        setNotice(`已将 ${confirm.person.name} 调整为${confirm.role === "admin" ? "管理者" : "志愿者"}`);
      }
      setConfirm(null);
      setSelected(new Set());
      await loadPeople();
    } catch (caught) {
      if (isSessionError(caught)) return onLogout();
      setNotice(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  async function downloadTemplate() {
    try {
      const response = await fetch("/api/admin/import-template.xlsx", { credentials: "same-origin" });
      if (!response.ok) throw new Error("download failed");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "保险箱授权名单导入模板.xlsx";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setNotice("模板下载失败，请重试");
    }
  }

  const allVisibleSelected = filtered.length > 0 && filtered.every((person) => selected.has(person.id));

  return (
    <div className="app-shell page-enter">
      <AppHeader user={user} onLogout={onLogout} />
      <main className="content">
        <div className="page-intro page-intro--admin">
          <div><h1>管理中心</h1><p>维护当前密码与授权人员。</p></div>
          <span className="permission-badge"><Shield size={16} aria-hidden="true" />管理权限已核验</span>
        </div>

        <VaultPanel
          onSessionExpired={onLogout}
          refreshKey={vaultRefresh}
          action={
            <button className="button button--secondary" type="button" onClick={() => setPasswordOpen(true)}>
              <KeyRound aria-hidden="true" size={17} />修改密码
            </button>
          }
        />

        <section className="people-section" aria-labelledby="people-title">
          <div className="section-heading section-heading--people">
            <div><h2 id="people-title">授权人员</h2><p>共 {people.length} 人，调整后权限将在下一次请求生效。</p></div>
            <div className="import-actions">
              <button className="button button--secondary" type="button" onClick={() => setImportRole("volunteer")}>
                <FileUp aria-hidden="true" size={17} />导入志愿者
              </button>
              <button className="button button--primary" type="button" onClick={() => setImportRole("admin")}>
                <UserCog aria-hidden="true" size={17} />导入管理者
              </button>
            </div>
          </div>

          <div className="people-toolbar">
            <label className="search-field">
              <Search aria-hidden="true" size={18} />
              <span className="visually-hidden">查找姓名或学号</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="查找姓名或学号" />
            </label>
            <label className="select-field">
              <span className="visually-hidden">按角色筛选</span>
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as "all" | Role)}>
                <option value="all">全部角色</option><option value="admin">管理者</option><option value="volunteer">志愿者</option>
              </select>
              <ChevronDown aria-hidden="true" size={17} />
            </label>
            <button className="button button--quiet template-button" type="button" onClick={() => void downloadTemplate()}>
              <Download aria-hidden="true" size={17} />导入模板
            </button>
          </div>

          {peopleLoading ? (
            <div className="list-state"><span className="spinner" />正在加载人员…</div>
          ) : peopleError ? (
            <div className="list-state list-state--error" role="alert">
              <span>{peopleError}</span><button className="button button--secondary" type="button" onClick={() => void loadPeople()}>重试</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="list-state">
              <Users aria-hidden="true" size={28} />
              <strong>{people.length === 0 ? "暂无人员，请先导入名单" : "未找到匹配人员"}</strong>
              {people.length > 0 ? <button className="button button--quiet" type="button" onClick={() => { setQuery(""); setRoleFilter("all"); }}>清除条件</button> : null}
            </div>
          ) : (
            <div className="people-table-wrap">
              <table className="people-table">
                <thead>
                  <tr>
                    <th className="checkbox-cell"><input type="checkbox" aria-label="选择当前结果" checked={allVisibleSelected} onChange={(event) => selectVisible(event.target.checked)} /></th>
                    <th>姓名</th><th>学号</th><th>角色</th><th><span className="visually-hidden">操作</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((person) => (
                    <tr key={person.id} className={selected.has(person.id) ? "is-selected" : ""}>
                      <td className="checkbox-cell" data-label="选择"><input type="checkbox" aria-label={`选择 ${person.name}`} checked={selected.has(person.id)} onChange={() => toggle(person.id)} /></td>
                      <td data-label="姓名"><strong>{person.name}</strong></td>
                      <td data-label="学号" className="tabular">{person.studentId}</td>
                      <td data-label="角色"><span className={`role-badge role-badge--${person.role}`}>{person.role === "admin" ? "管理者" : "志愿者"}</span></td>
                      <td className="row-actions">
                        <button className="text-button" type="button" onClick={() => setConfirm({ kind: "role", person, role: person.role === "admin" ? "volunteer" : "admin" })}>
                          {person.role === "admin" ? "转为志愿者" : "设为管理者"}
                        </button>
                        <button className="icon-button icon-button--danger" type="button" aria-label={`删除 ${person.name}`} onClick={() => setConfirm({ kind: "delete", person })}>
                          <Trash2 aria-hidden="true" size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {selected.size > 0 ? (
            <div className="bulk-bar" role="region" aria-label="批量操作">
              <span>已选择 {selected.size} 人</span>
              <button className="button button--danger" type="button" onClick={() => setConfirm({ kind: "batch", ids: [...selected] })}>
                <Trash2 aria-hidden="true" size={17} />批量删除
              </button>
            </div>
          ) : null}
        </section>
      </main>

      <PasswordDialog
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        onUpdated={(message) => { setNotice(message); setVaultRefresh((value) => value + 1); setPasswordOpen(false); }}
        onSessionExpired={onLogout}
      />
      <ImportDialog
        open={Boolean(importRole)}
        role={importRole ?? "volunteer"}
        onClose={() => setImportRole(null)}
        onImported={(message) => { setNotice(message); void loadPeople(); }}
        onSessionExpired={onLogout}
        onDownloadTemplate={() => void downloadTemplate()}
      />
      <ConfirmDialog value={confirm} pending={pending} onClose={() => setConfirm(null)} onConfirm={() => void executeConfirm()} />

      {notice ? <div className="toast" role="status"><CheckCircle2 aria-hidden="true" size={19} /><span>{notice}</span></div> : null}
    </div>
  );
}

function PasswordDialog({
  open,
  onClose,
  onUpdated,
  onSessionExpired,
}: {
  open: boolean;
  onClose: () => void;
  onUpdated: (message: string) => void;
  onSessionExpired: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) { setPassword(""); setConfirmation(""); setError(""); }
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{4,32}$/u.test(password)) return setError("请输入 4–32 位数字");
    if (password !== confirmation) return setError("两次输入的密码不一致");
    setPending(true);
    setError("");
    try {
      const result = await apiRequest<{ status: "updated" | "unchanged" }>("/api/admin/vault", {
        method: "PUT",
        body: JSON.stringify({ password, confirmation }),
      });
      onUpdated(result.status === "updated" ? "密码已更新" : "密码未变化");
    } catch (caught) {
      if (isSessionError(caught)) return onSessionExpired();
      setError(errorMessage(caught, "更新失败，请重试"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="修改保险箱密码" description="新密码保存后将立即替换当前值，不保留历史。">
      <form onSubmit={submit}>
        <div className="modal__body form-stack">
          <label className="field"><span>新密码</span><input autoFocus inputMode="numeric" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="4–32 位数字" /></label>
          <label className="field"><span>确认新密码</span><input inputMode="numeric" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="再次输入新密码" /></label>
          {error ? <div className="inline-alert inline-alert--error" role="alert">{error}</div> : null}
        </div>
        <div className="modal__actions"><button className="button button--quiet" type="button" onClick={onClose}>取消</button><button className="button button--primary" type="submit" disabled={pending}>{pending ? "正在保存…" : "保存新密码"}</button></div>
      </form>
    </Modal>
  );
}

function ConfirmDialog({ value, pending, onClose, onConfirm }: { value: ConfirmAction | null; pending: boolean; onClose: () => void; onConfirm: () => void }) {
  if (!value) return null;
  const deleting = value.kind === "delete" || value.kind === "batch";
  const title = value.kind === "delete" ? `移除 ${value.person.name}？` : value.kind === "batch" ? `移除所选 ${value.ids.length} 人？` : `调整 ${value.person.name} 的角色？`;
  const description = deleting
    ? "删除后其已有会话将在下一次请求时失效；此操作不会保留人员历史。"
    : value.role === "admin" ? "该人员将获得密码修改和人员管理权限。" : "该人员将失去密码修改和人员管理权限。";
  return (
    <Modal open onClose={onClose} title={title} description={description}>
      <div className="modal__actions modal__actions--standalone">
        <button className="button button--quiet" type="button" onClick={onClose}>取消</button>
        <button className={`button ${deleting ? "button--danger" : "button--primary"}`} type="button" disabled={pending} onClick={onConfirm}>{pending ? "正在处理…" : "确认操作"}</button>
      </div>
    </Modal>
  );
}
