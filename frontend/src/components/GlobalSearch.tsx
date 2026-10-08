import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/axiosInstance';
import * as Icon from './icons';

interface SearchHit {
  id: string;
  title: string;
  sub: string;
  processId?: string | null;
}

interface SearchResult {
  empreendimentos: SearchHit[];
  proponentes: SearchHit[];
  processos: SearchHit[];
}

type Group = 'proponentes' | 'processos' | 'empreendimentos';
const GROUPS: { key: Group; label: string }[] = [
  { key: 'proponentes', label: 'Proponentes' },
  { key: 'processos', label: 'Processos' },
  { key: 'empreendimentos', label: 'Empreendimentos' },
];

const MIN = 3;
const DEBOUNCE_MS = 300;

// FE-30: busca global da topbar (GET /search). Começa com 3 caracteres, espera
// 300 ms sem digitar antes de buscar e leva direto ao resultado. Ctrl/⌘+K foca.
export function GlobalSearch({ onOpenProcess, onOpenEmpreendimento, onOpenProponentes }: {
  onOpenProcess: (id: string) => void;
  onOpenEmpreendimento: (id: string) => void;
  onOpenProponentes: () => void;
}) {
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  const enabled = term.length >= MIN;
  const { data, isFetching } = useQuery<SearchResult>({
    queryKey: ['search', term],
    queryFn: () => api.get<SearchResult>('/search', { params: { q: term } }).then(r => r.data),
    enabled,
    staleTime: 30_000,
  });

  const hits = enabled && data
    ? GROUPS.flatMap(g => data[g.key].map(hit => ({ group: g.key, hit })))
    : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, []);

  const go = (group: Group, hit: SearchHit) => {
    setOpen(false);
    setText('');
    setTerm('');
    input.current?.blur();
    if (group === 'empreendimentos') onOpenEmpreendimento(hit.id);
    else if (group === 'processos') onOpenProcess(hit.id);
    else if (hit.processId) onOpenProcess(hit.processId);
    else onOpenProponentes();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      input.current?.blur();
    } else if (e.key === 'ArrowDown' && hits.length) {
      e.preventDefault();
      setActive(a => (a + 1) % hits.length);
    } else if (e.key === 'ArrowUp' && hits.length) {
      e.preventDefault();
      setActive(a => (a - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter' && hits[active]) {
      go(hits[active].group, hits[active].hit);
    }
  };

  const typed = text.trim();
  const showPanel = open && typed.length > 0;

  return (
    <div className="ds-search-wrap" ref={wrap}>
      <div className="ds-tb-search" onClick={() => input.current?.focus()}>
        <Icon.Search size={13} />
        <input
          ref={input}
          type="search"
          value={text}
          placeholder="Buscar processo, proponente…"
          aria-label="Buscar processo, proponente ou empreendimento"
          aria-expanded={showPanel}
          aria-controls="ds-search-results"
          onChange={e => { setText(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <kbd>⌘K</kbd>
      </div>
      {showPanel && (
        <div className="ds-search-dd" id="ds-search-results" role="listbox" aria-label="Resultados da busca">
          {typed.length < MIN ? (
            <div className="ds-notif-empty">Digite pelo menos {MIN} caracteres</div>
          ) : !data || term !== typed || (isFetching && !hits.length) ? (
            <div className="ds-notif-empty">Buscando...</div>
          ) : hits.length === 0 ? (
            <div className="ds-notif-empty">Nada encontrado para “{typed}”</div>
          ) : (
            GROUPS.filter(g => data[g.key].length > 0).map(g => (
              <div key={g.key}>
                <div className="ds-search-group">{g.label}</div>
                {data[g.key].map(hit => {
                  const index = hits.findIndex(h => h.group === g.key && h.hit.id === hit.id);
                  return (
                    <button
                      key={hit.id}
                      role="option"
                      aria-selected={index === active}
                      className={`ds-search-item ${index === active ? 'active' : ''}`}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => go(g.key, hit)}
                    >
                      <span className="ds-notif-title">{hit.title}</span>
                      {hit.sub && <span className="ds-notif-sub">{hit.sub}</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
