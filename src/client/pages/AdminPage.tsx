import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  FileUp,
  KeyRound,
  Search,
  Shield,
  Trash2,
  UploadCloud,
  UserCog,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createSiteConfig, serializeSiteConfig } from "../config/siteConfig";
import type { PersonRecord, Role, UnlockedSession } from "../config/types";
import { AppHeader } from "../components/AppHeader";
import { ImportDialog } from "../components/ImportDialog";
import { Modal } from "../components/Modal";
import { VaultPanel } from "../components/VaultPanel";
import { createTemplate } from "../imports";

interface AdminPageProps {
  session: UnlockedSession;
  onLogout: () => void;
}

type ConfirmAction =
  | { kind: "delete"; person: PersonRecord }
  | { kind: "batch"; ids: string[] }
  | { kind: "role"; person: PersonRecord; role: Role };

type Notice = { text: string; kind: "success" | "error" };

export function AdminPage({ session, onLogout }: AdminPageProps) {
  const [people, setPeople] = useState<PersonRecord[]>(session.people ?? []);
  const [password, setPassword] = useState(session.password);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importRole, setImportRole] = useState<Role | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingChanges, setPendingChanges] = useState(0);
  const [downloadedVersion, setDownloadedVersion] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [view, setView] = useState<"admin" | "publish">("admin");

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (pendingChanges === 0) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [pendingChanges]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return people.filter((person) => (
      (roleFilter === "all" || person.role === roleFilter)
      && (!normalized || person.name.toLocaleLowerCase("zh-CN").includes(normalized) || person.studentId.includes(query.trim()))
    ));
  }, [people, query, roleFilter]);

  function markChanged(message: string) {
    setPendingChanges((value) => value + 1);
    setNotice({ text: message, kind: "success" });
  }

  function updatePeople(next: PersonRecord[], message: string) {
    setPeople(next);
    setSelected(new Set());
    markChanged(message);
  }

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

  function executeConfirm() {
    if (!confirm) return;
    let next = people;
    let message = "";
    if (confirm.kind === "delete") {
      next = people.filter((person) => person.id !== confirm.person.id);
      message = `已将 ${confirm.person.name} 移出草稿`;
    } else if (confirm.kind === "batch") {
      const ids = new Set(confirm.ids);
      next = people.filter((person) => !ids.has(person.id));
      message = `已将 ${confirm.ids.length} 人移出草稿`;
    } else {
      next = people.map((person) => person.id === confirm.person.id ? { ...person, role: confirm.role } : person);
      message = `已将 ${confirm.person.name} 调整为${confirm.role === "admin" ? "管理者" : "志愿者"}`;
    }
    if (!next.some((person) => person.role === "admin")) {
      setNotice({ text: "必须至少保留一名管理者", kind: "error" });
      return;
    }
    updatePeople(next, `${message}，等待发布`);
    setConfirm(null);
  }

  async function downloadTemplate() {
    try {
      const bytes = await createTemplate();
      downloadBlob(new Blob([new Uint8Array(bytes)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "保险箱授权名单导入模板.xlsx");
    } catch {
      setNotice({ text: "模板下载失败，请重试", kind: "error" });
    }
  }

  async function exportConfiguration() {
    setExporting(true);
    setExportProgress(0);
    try {
      const config = await createSiteConfig(people, password, {
        onProgress: (completed, total) => setExportProgress(Math.round((completed / total) * 100)),
      });
      downloadBlob(new Blob([serializeSiteConfig(config)], { type: "application/json;charset=utf-8" }), "site-config.json");
      setDownloadedVersion(config.version);
      setPendingChanges(0);
      setNotice({ text: "站点配置已下载，下一步上传到 GitHub", kind: "success" });
      openPublishGuide();
    } catch (caught) {
      setNotice({ text: caught instanceof Error ? caught.message : "配置生成失败，请重试", kind: "error" });
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  }

  function openPublishGuide() {
    setView("publish");
    window.location.hash = "/publish";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function returnToAdmin() {
    setView("admin");
    window.location.hash = "/admin";
  }

  function guardedLogout() {
    if (pendingChanges > 0 && !window.confirm("尚有未下载的更改，退出后将丢失。仍要退出吗？")) return;
    onLogout();
  }

  if (view === "publish") {
    return <PublishGuide session={session} downloadedVersion={downloadedVersion} onBack={returnToAdmin} onLogout={guardedLogout} />;
  }

  const allVisibleSelected = filtered.length > 0 && filtered.every((person) => selected.has(person.id));
  const publishTitle = pendingChanges > 0
    ? `有 ${pendingChanges} 项更改尚未下载`
    : downloadedVersion ? "配置已下载，等待上传 GitHub" : "当前显示线上配置";
  const publishText = pendingChanges > 0
    ? "这些操作只在当前标签页中，下载并发布后才会对其他设备生效。"
    : downloadedVersion ? `待发布版本：${downloadedVersion}` : `线上版本：${session.configVersion}`;

  return (
    <div className="app-shell page-enter">
      <AppHeader user={session.user} onLogout={guardedLogout} />
      <main className="content">
        <div className="page-intro page-intro--admin">
          <div><h1>管理中心</h1><p>编辑当前密码与人员配置。</p></div>
          <span className="permission-badge"><Shield size={16} aria-hidden="true" />管理配置已解锁</span>
        </div>

        <VaultPanel password={password} configVersion={session.configVersion} action={<button className="button button--secondary" type="button" onClick={() => setPasswordOpen(true)}><KeyRound aria-hidden="true" size={17} />修改密码</button>} />

        <section className={`publish-status ${pendingChanges > 0 ? "publish-status--pending" : ""}`} aria-labelledby="publish-status-title">
          <div className="publish-status__icon" aria-hidden="true"><UploadCloud size={22} /></div>
          <div className="publish-status__copy"><h2 id="publish-status-title">{publishTitle}</h2><p>{publishText}</p></div>
          <div className="publish-status__actions">
            <button className="button button--quiet" type="button" onClick={openPublishGuide}>发布步骤</button>
            <button className="button button--primary" type="button" disabled={exporting} onClick={() => void exportConfiguration()}>
              <Download aria-hidden="true" size={17} />{exporting ? `正在生成 ${exportProgress}%` : "下载站点配置"}
            </button>
          </div>
        </section>

        <section className="people-section" aria-labelledby="people-title">
          <div className="section-heading section-heading--people">
            <div><h2 id="people-title">授权人员</h2><p>共 {people.length} 人，更改需下载并发布后生效。</p></div>
            <div className="import-actions">
              <button className="button button--secondary" type="button" onClick={() => setImportRole("volunteer")}><FileUp aria-hidden="true" size={17} />导入志愿者</button>
              <button className="button button--primary" type="button" onClick={() => setImportRole("admin")}><UserCog aria-hidden="true" size={17} />导入管理者</button>
            </div>
          </div>

          <div className="people-toolbar">
            <label className="search-field"><Search aria-hidden="true" size={18} /><span className="visually-hidden">查找姓名或学号</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="查找姓名或学号" /></label>
            <label className="select-field"><span className="visually-hidden">按角色筛选</span><select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as "all" | Role)}><option value="all">全部角色</option><option value="admin">管理者</option><option value="volunteer">志愿者</option></select><ChevronDown aria-hidden="true" size={17} /></label>
            <button className="button button--quiet template-button" type="button" onClick={() => void downloadTemplate()}><Download aria-hidden="true" size={17} />导入模板</button>
          </div>

          {filtered.length === 0 ? (
            <div className="list-state"><Users aria-hidden="true" size={28} /><strong>{people.length === 0 ? "暂无人员，请先导入名单" : "未找到匹配人员"}</strong>{people.length > 0 ? <button className="button button--quiet" type="button" onClick={() => { setQuery(""); setRoleFilter("all"); }}>清除条件</button> : null}</div>
          ) : (
            <div className="people-table-wrap">
              <table className="people-table">
                <thead><tr><th className="checkbox-cell"><input type="checkbox" aria-label="选择当前结果" checked={allVisibleSelected} onChange={(event) => selectVisible(event.target.checked)} /></th><th>姓名</th><th>学号</th><th>角色</th><th><span className="visually-hidden">操作</span></th></tr></thead>
                <tbody>{filtered.map((person) => (
                  <tr key={person.id} className={selected.has(person.id) ? "is-selected" : ""}>
                    <td className="checkbox-cell" data-label="选择"><input type="checkbox" aria-label={`选择 ${person.name}`} checked={selected.has(person.id)} onChange={() => toggle(person.id)} /></td>
                    <td data-label="姓名"><strong>{person.name}</strong></td><td data-label="学号" className="tabular">{person.studentId}</td><td data-label="角色"><span className={`role-badge role-badge--${person.role}`}>{person.role === "admin" ? "管理者" : "志愿者"}</span></td>
                    <td className="row-actions"><button className="text-button" type="button" onClick={() => setConfirm({ kind: "role", person, role: person.role === "admin" ? "volunteer" : "admin" })}>{person.role === "admin" ? "转为志愿者" : "设为管理者"}</button><button className="icon-button icon-button--danger" type="button" aria-label={`删除 ${person.name}`} onClick={() => setConfirm({ kind: "delete", person })}><Trash2 aria-hidden="true" size={17} /></button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {selected.size > 0 ? <div className="bulk-bar" role="region" aria-label="批量操作"><span>已选择 {selected.size} 人</span><button className="button button--danger" type="button" onClick={() => setConfirm({ kind: "batch", ids: [...selected] })}><Trash2 aria-hidden="true" size={17} />批量删除</button></div> : null}
        </section>
      </main>

      <PasswordDialog open={passwordOpen} currentPassword={password} onClose={() => setPasswordOpen(false)} onUpdated={(next) => { setPassword(next); setPasswordOpen(false); markChanged("密码已加入待发布更改"); }} />
      <ImportDialog open={Boolean(importRole)} role={importRole ?? "volunteer"} people={people} onClose={() => setImportRole(null)} onImported={updatePeople} onDownloadTemplate={() => void downloadTemplate()} />
      <ConfirmDialog value={confirm} onClose={() => setConfirm(null)} onConfirm={executeConfirm} />
      {notice ? <div className={`toast ${notice.kind === "error" ? "toast--error" : ""}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.kind === "error" ? <AlertCircle aria-hidden="true" size={19} /> : <CheckCircle2 aria-hidden="true" size={19} />}<span>{notice.text}</span></div> : null}
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function PasswordDialog({ open, currentPassword, onClose, onUpdated }: { open: boolean; currentPassword: string; onClose: () => void; onUpdated: (password: string) => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setPassword(""); setConfirmation(""); setError(""); } }, [open]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{4,32}$/u.test(password)) return setError("请输入 4–32 位数字");
    if (password !== confirmation) return setError("两次输入的密码不一致");
    if (password === currentPassword) { onClose(); return; }
    onUpdated(password);
  }

  return (
    <Modal open={open} onClose={onClose} title="修改保险箱密码" description="新值先进入当前草稿，下载并发布配置后才会在其他设备生效。">
      <form onSubmit={submit}>
        <div className="modal__body form-stack">
          <label className="field"><span>新密码</span><input autoFocus inputMode="numeric" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="4–32 位数字" /></label>
          <label className="field"><span>确认新密码</span><input inputMode="numeric" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="再次输入新密码" /></label>
          {error ? <div className="inline-alert inline-alert--error" role="alert">{error}</div> : null}
        </div>
        <div className="modal__actions"><button className="button button--quiet" type="button" onClick={onClose}>取消</button><button className="button button--primary" type="submit">加入草稿</button></div>
      </form>
    </Modal>
  );
}

function ConfirmDialog({ value, onClose, onConfirm }: { value: ConfirmAction | null; onClose: () => void; onConfirm: () => void }) {
  if (!value) return null;
  const deleting = value.kind === "delete" || value.kind === "batch";
  const title = value.kind === "delete" ? `从草稿移除 ${value.person.name}？` : value.kind === "batch" ? `从草稿移除所选 ${value.ids.length} 人？` : `调整 ${value.person.name} 的角色？`;
  const description = deleting ? "确认后会加入待发布更改；线上名单在上传新版配置前保持不变。" : value.role === "admin" ? "新版发布后，该人员将获得配置管理能力。" : "新版发布后，该人员将失去配置管理能力。";
  return <Modal open onClose={onClose} title={title} description={description}><div className="modal__actions modal__actions--standalone"><button className="button button--quiet" type="button" onClick={onClose}>取消</button><button className={`button ${deleting ? "button--danger" : "button--primary"}`} type="button" onClick={onConfirm}>确认加入草稿</button></div></Modal>;
}

function PublishGuide({ session, downloadedVersion, onBack, onLogout }: { session: UnlockedSession; downloadedVersion: string; onBack: () => void; onLogout: () => void }) {
  const repositoryUrl = import.meta.env.VITE_GITHUB_REPOSITORY_URL ?? "https://github.com/klbjy/safe-access-portal";
  const uploadUrl = `${repositoryUrl}/upload/main/public`;
  const actionsUrl = `${repositoryUrl}/actions`;
  return (
    <div className="app-shell page-enter">
      <AppHeader user={session.user} onLogout={onLogout} />
      <main className="content content--narrow publish-guide">
        <button className="button button--quiet back-button" type="button" onClick={onBack}><ArrowLeft aria-hidden="true" size={17} />返回管理中心</button>
        <div className="page-intro"><h1>发布新版配置</h1><p>上传成功并不等于已上线，请等待 GitHub Actions 完成。</p></div>
        <section className="publish-guide__summary" aria-label="配置版本">
          <div><span>刚下载的版本</span><strong className="tabular">{downloadedVersion || "尚未下载"}</strong></div>
          <div><span>当前线上版本</span><strong className="tabular">{session.configVersion}</strong></div>
        </section>
        <ol className="publish-steps">
          <li><div><strong>确认文件名</strong><p>下载文件必须名为 <code>site-config.json</code>。如尚未下载，请先返回管理中心。</p></div></li>
          <li><div><strong>上传并覆盖配置</strong><p>打开仓库的 <code>public</code> 目录上传页，拖入文件并确认替换同名文件。</p><a className="button button--primary" href={uploadUrl} target="_blank" rel="noreferrer">打开 GitHub 上传页<ExternalLink aria-hidden="true" size={16} /></a></div></li>
          <li><div><strong>提交变更并等待部署</strong><p>在 GitHub 提交文件后，打开 Actions；等待最新的 Pages 工作流显示绿色成功。</p><a className="button button--secondary" href={actionsUrl} target="_blank" rel="noreferrer">查看 GitHub Actions<ExternalLink aria-hidden="true" size={16} /></a></div></li>
          <li><div><strong>重新打开网站核对</strong><p>部署成功后刷新网站并重新登录。管理中心显示的线上版本应与刚下载的版本一致。</p></div></li>
        </ol>
        <div className="publish-warning"><AlertCircle aria-hidden="true" size={19} /><p>发布失败时，线上仍使用旧配置。不要反复生成文件，先检查 Actions 的失败原因。</p></div>
      </main>
    </div>
  );
}
