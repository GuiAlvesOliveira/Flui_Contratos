import { useEffect } from 'react';
import * as Icon from './icons';

export interface ToastMessage {
  kind: 'error' | 'success';
  title: string;
  detail?: string[];
}

// Aviso flutuante no canto da tela; some sozinho (erros ficam mais tempo).
export function Toast({ toast, onClose }: { toast: ToastMessage | null; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, toast.kind === 'error' ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [toast, onClose]);

  if (!toast) return null;
  return (
    <div className={`ds-toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
      {toast.kind === 'error'
        ? <Icon.AlertTriangle size={14} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 2 }} />
        : <Icon.Check size={14} style={{ color: 'var(--green)', flexShrink: 0, marginTop: 2 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="ds-toast-title">{toast.title}</div>
        {toast.detail && toast.detail.length > 0 && (
          <ul className="ds-toast-list">
            {toast.detail.map(d => <li key={d}>{d}</li>)}
          </ul>
        )}
      </div>
      <button className="ds-btn ghost sm" onClick={onClose} aria-label="Fechar aviso" style={{ padding: '2px 4px' }}>
        <Icon.X size={12} />
      </button>
    </div>
  );
}
