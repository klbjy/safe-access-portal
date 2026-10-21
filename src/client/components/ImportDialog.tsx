import { Download, FileSpreadsheet, UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ImportCommitResponse, ImportPreviewResponse, Role } from "../../shared/api";
import { apiRequest, errorMessage, isSessionError } from "../api";
import { Modal } from "./Modal";

interface ImportDialogProps {
  open: boolean;
  role: Role;
  onClose: () => void;
  onImported: (message: string) => void;
  onSessionExpired: () => void;
  onDownloadTemplate: () => void;
}

const roleLabel = (role: Role) => (role === "admin" ? "管理者" : "志愿者");

export function ImportDialog({
  open,
  role,
  onClose,
  onImported,
  onSessionExpired,
  onDownloadTemplate,
}: ImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setPreview(null);
    setError("");
    setPending(false);
  }, [open, role]);

  function choose(next: File | null) {
    setFile(next);
    setPreview(null);
    setError("");
  }

  async function runPreview() {
    if (!file) return setError("请先选择文件");
    setPending(true);
    setError("");
    const form = new FormData();
    form.set("role", role);
    form.set("file", file);
    try {
      setPreview(await apiRequest<ImportPreviewResponse>("/api/admin/import/preview", { method: "POST", body: form }));
    } catch (caught) {
      if (isSessionError(caught)) return onSessionExpired();
      setError(errorMessage(caught, "文件预览失败，请重试"));
    } finally {
      setPending(false);
    }
  }

  async function commit() {
    if (!preview) return;
    const records = preview.rows
      .filter((row) => row.status === "add" || row.status === "upgrade")
      .map(({ name, studentId }) => ({ name, studentId }));
    if (records.length === 0) return setError("没有可写入的记录");
    setPending(true);
    setError("");
    try {
      const result = await apiRequest<ImportCommitResponse>("/api/admin/import/commit", {
        method: "POST",
        body: JSON.stringify({ role, records }),
      });
      onImported(`已完成导入：新增 ${result.counts.add} 人，升级 ${result.counts.upgrade} 人`);
      onClose();
    } catch (caught) {
      if (isSessionError(caught)) return onSessionExpired();
      setError(errorMessage(caught, "导入失败，请重新预览后重试"));
    } finally {
      setPending(false);
    }
  }

  const changeCount = preview ? preview.counts.add + preview.counts.upgrade : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={`导入${roleLabel(role)}`}
      description="文件只读取“姓名”和“学号”，联系电话等额外列不会保存。"
    >
      <div className="modal__body import-flow">
        <div
          className={`drop-zone ${dragging ? "drop-zone--dragging" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            choose(event.dataTransfer.files[0] ?? null);
          }}
        >
          <UploadCloud aria-hidden="true" size={31} />
          <strong>{file ? file.name : "拖入 .xlsx 或 .csv 文件"}</strong>
          <span>{file ? `${Math.max(1, Math.ceil(file.size / 1024))} KiB` : "最多 256 KiB、500 条非空记录"}</span>
          <button className="button button--secondary" type="button" onClick={() => inputRef.current?.click()}>
            选择文件
          </button>
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept=".xlsx,.csv"
            onChange={(event) => choose(event.target.files?.[0] ?? null)}
          />
        </div>

        <button className="template-link" type="button" onClick={onDownloadTemplate}>
          <Download aria-hidden="true" size={16} />下载标准导入模板
        </button>

        {error ? <div className="inline-alert inline-alert--error" role="alert">{error}</div> : null}

        {preview ? (
          <section className="preview" aria-labelledby="preview-title">
            <div className="preview__heading">
              <div>
                <h3 id="preview-title">导入预览</h3>
                <p>{preview.ignoredColumns.length > 0 ? `已忽略列：${preview.ignoredColumns.join("、")}` : "未发现额外列"}</p>
              </div>
              <div className="preview-counts" aria-label="导入分类统计">
                <span>新增 {preview.counts.add}</span>
                <span>升级 {preview.counts.upgrade}</span>
                <span>跳过 {preview.counts.skip}</span>
                <span className={preview.counts.error ? "text-danger" : ""}>错误 {preview.counts.error}</span>
              </div>
            </div>
            <div className="preview-table-wrap">
              <table className="preview-table">
                <thead><tr><th>行</th><th>姓名</th><th>学号</th><th>结果</th></tr></thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={`${row.row}-${row.studentId}`}>
                      <td>{row.row}</td><td>{row.name || "—"}</td><td>{row.studentId || "—"}</td>
                      <td><span className={`status status--${row.status}`}>{row.message}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
      <div className="modal__actions">
        <button className="button button--quiet" type="button" onClick={onClose}>取消</button>
        {!preview ? (
          <button className="button button--primary" type="button" disabled={!file || pending} onClick={() => void runPreview()}>
            <FileSpreadsheet aria-hidden="true" size={18} />{pending ? "正在解析…" : "预览文件"}
          </button>
        ) : (
          <button className="button button--primary" type="button" disabled={changeCount === 0 || pending} onClick={() => void commit()}>
            {pending ? "正在导入…" : `确认导入 ${changeCount} 人`}
          </button>
        )}
      </div>
    </Modal>
  );
}
