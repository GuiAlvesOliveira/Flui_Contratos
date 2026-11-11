import type { ReactNode } from 'react';
import { FluiMark } from './icons';

const STEPS = ['Cadastro', 'Análise de crédito', 'Análise jurídica', 'Cartório', 'Assinatura'];

// Moldura das telas de entrada (login, senha, cadastro inicial): o painel em
// tinta com o caminho do financiamento à esquerda e o formulário à direita.
// Só aparência — cada página continua dona do próprio formulário.
export function AuthLayout({ title, subtitle, wide = false, children }: {
  title: string;
  subtitle?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="ds-auth">
      <aside className="ds-auth-art" aria-hidden="true">
        <svg className="ds-auth-flow" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice">
          {/* cores e opacidade vêm do tema (.ds-auth-flow path em design.css) */}
          <path d="M-40 250 C 120 130, 230 400, 390 290 S 570 130, 660 250" strokeWidth="2" />
          <path d="M-40 330 C 130 220, 250 480, 410 370 S 580 220, 660 330" strokeWidth="2" />
          <path d="M-40 410 C 140 310, 270 560, 430 450 S 590 310, 660 410" strokeWidth="2" />
        </svg>
        <div className="ds-auth-brand">
          <FluiMark size={34} />
          Flui Contratos
        </div>
        <div className="ds-auth-pitch">
          <h2>O financiamento <em>flui</em> do cadastro à assinatura.</h2>
          <p>Processos, documentos e prazos da assessoria em um só lugar — e o cliente acompanhando cada etapa.</p>
        </div>
        <ol className="ds-auth-steps">
          {STEPS.map((s, i) => <li key={s}><span>{i + 1}</span>{s}</li>)}
        </ol>
      </aside>
      <main className="ds-auth-main">
        <div className={`ds-auth-card ${wide ? 'wide' : ''}`}>
          <div className="ds-auth-mark">
            <FluiMark size={28} />
            Flui Contratos
          </div>
          <h1>{title}</h1>
          {subtitle && <p className="ds-auth-sub">{subtitle}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}
