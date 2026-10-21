import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

interface ModalProps {
  title: string;
  description?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

export function Modal({ title, description, open, onClose, children, wide = false }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal--wide" : ""}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <div className="modal__header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description ? <p id={descriptionId}>{description}</p> : null}
        </div>
        <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
          <X aria-hidden="true" size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
