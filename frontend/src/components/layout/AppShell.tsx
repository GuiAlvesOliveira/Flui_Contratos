import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../auth/useAuth';
import { api } from '../../api/axiosInstance';
import * as Icon from '../icons';
import { DashboardPage } from '../../pages/DashboardPage';
import { AnalistaDashboard } from '../AnalistaDashboard';
import { EmpreendimentosPage } from '../../pages/EmpreendimentosPage';
import { EmpreendimentoDetailPage } from '../../pages/EmpreendimentoDetailPage';
import { ProponentesPage } from '../../pages/ProponentesPage';
import { ProponenteDetailPage } from '../../pages/ProponenteDetailPage';
import { WorkflowPage } from '../../pages/WorkflowPage';
import { LogsPage } from '../../pages/LogsPage';
import { DevApiMenu } from '../../pages/DevApiMenu';

// ── Route state ────────────────────────────────────────────────────────────────

type Route =
  | { page: 'dashboard' }
  | { page: 'empreendimentos' }
  | { page: 'empreendimento-detail'; id: string }
  | { page: 'proponentes' }
  | { page: 'proponente-detail'; id: string; back?: Route }
  | { page: 'workflow' }
  | { page: 'client-processes' }
  | { page: 'logs' }
  | { page: 'tarefas' }
  | { page: 'calendario' }
  | { page: 'relatorios' }
  | { page: 'config' };

type NavPage = 'dashboard' | 'empreendimentos' | 'proponentes' | 'workflow' | 'tarefas' | 'calendario' | 'relatorios' | 'logs' | 'config';

const NAV_SECTIONS = [
  {
    title: 'Operação',
    items: [
      { id: 'dashboard' as NavPage, label: 'Dashboard', icon: 'Home' },
      { id: 'empreendimentos' as NavPage, label: 'Empreendimentos', icon: 'Building' },
      { id: 'proponentes' as NavPage, label: 'Proponentes', icon: 'Users' },
      { id: 'workflow' as NavPage, label: 'Workflow', icon: 'Layout' },
      { id: 'tarefas' as NavPage, label: 'Tarefas', icon: 'CheckSquare' },
    ],
  },
  {
    title: 'Gestão',
    items: [
      { id: 'calendario' as NavPage, label: 'Calendário', icon: 'Calendar' },
      { id: 'relatorios' as NavPage, label: 'Relatórios', icon: 'BarChart' },
    ],
  },
  {
    title: '',
    items: [
      { id: 'config' as NavPage, label: 'Configurações', icon: 'Settings' },
    ],
  },
];

const ICON_MAP: Record<string, React.ComponentType<{ size?: number }>> = {
  Home: Icon.Home,
  Building: Icon.Building,
  Users: Icon.Users,
  Layout: Icon.Layout,
  CheckSquare: Icon.CheckSquare,
  Calendar: Icon.Calendar,
  BarChart: Icon.BarChart,
  ClipboardList: Icon.ClipboardList,
  Settings: Icon.Settings,
};

const PAGE_LABELS: Record<NavPage, string> = {
  dashboard: 'Dashboard',
  empreendimentos: 'Empreendimentos',
  proponentes: 'Proponentes',
  workflow: 'Workflow',
  tarefas: 'Tarefas',
  calendario: 'Calendário',
  relatorios: 'Relatórios',
  logs: 'Log de Ações',
  config: 'Configurações',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function initials(name: string | null): string {
  if (!name) return '?';
  return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
}

function roleLabel(role: string | null): string {
  if (role === 'dono') return 'Gestor';
  if (role === 'analista') return 'Analista';
  if (role === 'cliente') return 'Cliente';
  return role ?? '';
}

function breadcrumb(route: Route): string {
  if (route.page === 'empreendimento-detail') return 'Empreendimentos / Detalhe';
  if (route.page === 'proponente-detail') {
    const origin = route.back?.page;
    if (origin === 'empreendimento-detail') return 'Empreendimentos / Processo';
    if (origin === 'proponentes') return 'Proponentes / Detalhe';
    return 'Workflow / Processo';
  }
  if (route.page in PAGE_LABELS) return PAGE_LABELS[route.page as NavPage];
  return '';
}

function activeNavPage(route: Route): NavPage {
  if (route.page === 'empreendimento-detail') return 'empreendimentos';
  if (route.page === 'proponente-detail') {
    const origin = route.back?.page;
    if (origin === 'logs') return 'logs';
    if (origin === 'empreendimento-detail') return 'empreendimentos';
    return 'proponentes';
  }
  return route.page as NavPage;
}

// ── Client process list ────────────────────────────────────────────────────────

function ClientProcessListPage({
  processes,
  onOpen,
}: {
  processes: { id: string; stage?: string; unidade?: { identificacao: string } | null; updatedAt?: string }[];
  onOpen: (id: string) => void;
}) {
  const STAGE_LABELS: Record<string, string> = {
    inicial: 'Primeiro Contato',
    cliente_ativo: 'Cliente Ativo',
    aprovado: 'Aprovado',
    em_analise_banco: 'Análise Banco',
    aguardando_assinatura: 'Ag. Assinatura',
    em_emissao: 'Em Emissão',
    juridico: 'Jurídico',
    cliente_inativo: 'Inativo',
    credito_recusado: 'Crédito Recusado',
    processo_pendencia: 'Pendência',
  };

  return (
    <div className="ds-page">
      <div className="ds-page-hdr">
        <div>
          <h1>Meus Processos</h1>
          <p>{processes.length} processo{processes.length !== 1 ? 's' : ''} em andamento</p>
        </div>
      </div>
      <div className="ds-card">
        <table className="ds-table">
          <thead>
            <tr>
              <th>Processo</th>
              <th>Unidade</th>
              <th>Etapa</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {processes.map((p, i) => (
              <tr key={p.id} onClick={() => onOpen(p.id)} style={{ cursor: 'pointer' }}>
                <td style={{ fontWeight: 500 }}>Processo {i + 1}</td>
                <td>{p.unidade?.identificacao ?? '—'}</td>
                <td>
                  <span className="ds-badge blue">
                    <span className="dot" />
                    {p.stage ? (STAGE_LABELS[p.stage] ?? p.stage) : '—'}
                  </span>
                </td>
                <td><Icon.ChevronRight size={14} style={{ color: 'var(--text-faint)' }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Coming soon ────────────────────────────────────────────────────────────────

function ComingSoonPage({ label }: { label: string }) {
  return (
    <div className="ds-page">
      <div className="ds-page-hdr">
        <div>
          <h1>{label}</h1>
          <p>Esta área está em desenvolvimento.</p>
        </div>
      </div>
      <div className="ds-card">
        <div className="ds-card-body" style={{ padding: 60, textAlign: 'center', color: 'var(--text-faint)', background: 'repeating-linear-gradient(135deg, #fafafa 0 12px, #fff 12px 24px)', borderRadius: 'var(--radius)' }}>
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>[ tela em construção ]</div>
        </div>
      </div>
    </div>
  );
}

// ── Route persistence ──────────────────────────────────────────────────────────

const ROUTE_KEY = 'flui_route';

function getInitialRoute(): Route {
  try {
    const saved = sessionStorage.getItem(ROUTE_KEY);
    if (saved) return JSON.parse(saved) as Route;
  } catch { /* ignore */ }
  return { page: 'dashboard' };
}

// ── Shell ──────────────────────────────────────────────────────────────────────

export function AppShell() {
  const { name, role, logout } = useAuth();
  const [route, setRoute] = useState<Route>(getInitialRoute);

  function navigate(r: Route) {
    setRoute(r);
    try { sessionStorage.setItem(ROUTE_KEY, JSON.stringify(r)); } catch { /* ignore */ }
  }

  // Clients: auto-navigate — 1 process → direct; multiple → process list
  const { data: clientProcesses = [] } = useQuery<{ id: string }[]>({
    queryKey: ['processes'],
    queryFn: () => api.get<{ id: string }[]>('/processes').then(r => r.data),
    enabled: role === 'cliente',
  });

  useEffect(() => {
    if (role === 'cliente' && clientProcesses.length > 0 && route.page === 'dashboard') {
      if (clientProcesses.length === 1) {
        navigate({ page: 'proponente-detail', id: clientProcesses[0].id });
      } else {
        navigate({ page: 'client-processes' });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, clientProcesses.length]);

  const active = activeNavPage(route);

  return (
    <div className="ds-app">
      {/* Sidebar */}
      <aside className="ds-sidebar">
        <div className="ds-sb-brand" onClick={() => navigate({ page: 'dashboard' })}>
          <div className="ds-sb-logo"><span>F</span></div>
          <div>
            <div className="ds-sb-brand-name">Flui Contratos</div>
            <div className="ds-sb-brand-sub">Assessoria Imobiliária</div>
          </div>
        </div>

        {role !== 'cliente' && NAV_SECTIONS.map((section, idx) => (
          <div className="ds-sb-section" key={idx}>
            {section.title && <div className="ds-sb-section-title">{section.title}</div>}
            <nav className="ds-sb-nav">
              {section.items.map((item) => {
                const IconComp = ICON_MAP[item.icon];
                return (
                  <button
                    key={item.id}
                    className={`ds-sb-item ${active === item.id ? 'active' : ''}`}
                    onClick={() => navigate({ page: item.id })}
                  >
                    <span className="ico">{IconComp && <IconComp size={15} />}</span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        ))}

        {role === 'dono' && (
          <div className="ds-sb-section">
            <div className="ds-sb-section-title">Administração</div>
            <nav className="ds-sb-nav">
              <button
                className={`ds-sb-item ${active === 'logs' ? 'active' : ''}`}
                onClick={() => navigate({ page: 'logs' })}
              >
                <span className="ico"><Icon.ClipboardList size={15} /></span>
                <span>Log de Ações</span>
              </button>
            </nav>
          </div>
        )}

        <div className="ds-sb-footer">
          <div className="ds-avatar">{initials(name)}</div>
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <div className="ds-sb-user-name" style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
              {name ?? 'Usuário'}
            </div>
            <div className="ds-sb-user-role">{roleLabel(role)}</div>
          </div>
          <button className="ds-btn ghost sm" title="Sair" onClick={logout}>
            <Icon.X size={13} />
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="ds-main">
        {/* Topbar */}
        <div className="ds-topbar">
          <div className="ds-crumb">
            <span className="cur">{breadcrumb(route)}</span>
          </div>
          <div className="ds-tb-spacer" />
          <div className="ds-tb-search">
            <Icon.Search size={13} />
            <span>Buscar processo, proponente…</span>
            <kbd>⌘K</kbd>
          </div>
          <button className="ds-tb-icon-btn" title="Notificações">
            <Icon.Bell size={15} />
          </button>
          <button className="ds-tb-icon-btn" title="Ajuda">
            <Icon.Info size={15} />
          </button>
        </div>

        {/* Content */}
        <div className="ds-content">
          {route.page === 'dashboard' && role === 'analista' && (
            <AnalistaDashboard
              analistaName={name}
              onNavigate={(p) => navigate({ page: p as NavPage })}
            />
          )}
          {route.page === 'dashboard' && role !== 'analista' && (
            <DashboardPage onNavigate={(p) => navigate({ page: p as NavPage })} />
          )}
          {route.page === 'empreendimentos' && (
            <EmpreendimentosPage
              onOpen={(id) => navigate({ page: 'empreendimento-detail', id })}
            />
          )}
          {route.page === 'empreendimento-detail' && (
            <EmpreendimentoDetailPage
              empId={route.id}
              onBack={() => navigate({ page: 'empreendimentos' })}
              onOpenProcess={(id) =>
                navigate({ page: 'proponente-detail', id, back: { page: 'empreendimento-detail', id: route.id } })
              }
            />
          )}
          {route.page === 'proponentes' && (
            <ProponentesPage
              onOpenProcess={(id) =>
                navigate({ page: 'proponente-detail', id, back: { page: 'proponentes' } })
              }
            />
          )}
          {route.page === 'proponente-detail' && (
            <ProponenteDetailPage
              processId={route.id}
              onBack={() => navigate(route.back ?? { page: 'workflow' })}
              role={role}
            />
          )}
          {route.page === 'workflow' && (
            <WorkflowPage
              onOpenProcess={(id) =>
                navigate({ page: 'proponente-detail', id, back: { page: 'workflow' } })
              }
            />
          )}
          {route.page === 'client-processes' && (
            <ClientProcessListPage
              processes={clientProcesses}
              onOpen={(id) => navigate({ page: 'proponente-detail', id, back: { page: 'client-processes' } })}
            />
          )}
          {route.page === 'logs' && (
            <LogsPage
              onOpenProcess={(id) =>
                navigate({ page: 'proponente-detail', id, back: { page: 'logs' } })
              }
            />
          )}
          {(route.page === 'tarefas' || route.page === 'calendario' || route.page === 'relatorios' || route.page === 'config') && (
            <ComingSoonPage label={PAGE_LABELS[route.page]} />
          )}
        </div>
      </div>

      {role === 'dono' && <DevApiMenu />}
    </div>
  );
}
