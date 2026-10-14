import type { ProcessStage } from '../processes/process.entity';
import {
  documentRejectedMessage,
  documentsRequestedMessage,
  stageChangeMessages,
  stageEventType,
} from './message-templates';

const ctx = {
  tenantName: 'Assessoria Exemplo',
  portalUrl: 'https://app.exemplo.dev',
};
const client = { name: 'Helena', email: 'helena@exemplo.dev' };
const analista = { name: 'Rafael', email: 'rafael@exemplo.dev' };

const move = (fromStage: ProcessStage, toStage: ProcessStage, undo = false) =>
  stageChangeMessages(
    { client, analista, clientName: 'Helena', fromStage, toStage, undo },
    ctx,
  );

describe('BE-15_v2: the six points of the flow', () => {
  it.each<[string, ProcessStage, ProcessStage, string, string]>([
    [
      'recusa',
      'analise_credito',
      'credito_recusado',
      'credit_refused',
      'resultado da análise de crédito',
    ],
    [
      'análise bancária',
      'cadastro',
      'analise_credito',
      'bank_analysis',
      'seu processo está em análise no banco',
    ],
    [
      'crédito aprovado',
      'analise_credito',
      'credito_aprovado',
      'bank_analysis',
      'crédito aprovado',
    ],
    [
      'pendência',
      'cadastro',
      'processo_pendencia',
      'pending_alert',
      'pendência no seu processo',
    ],
    [
      'assinatura',
      'cartorio',
      'assinatura',
      'signature',
      'contrato pronto para assinatura',
    ],
    [
      'emissão (jurídico)',
      'credito_aprovado',
      'analise_juridica',
      'issuance',
      'Análise Jurídica',
    ],
    [
      'emissão (cartório)',
      'juridico_aprovado',
      'cartorio',
      'issuance',
      'Cartório',
    ],
    [
      'outras etapas',
      'inicial',
      'cadastro',
      'stage_changed',
      'seu processo está em Cadastro',
    ],
  ])('%s: %s → %s is %s', (_point, from, to, eventType, subject) => {
    const [toClient] = move(from, to);
    expect(stageEventType(to)).toBe(eventType);
    expect(toClient).toMatchObject({
      eventType,
      recipientRole: 'cliente',
      to: 'helena@exemplo.dev',
      subject: `Flui Contratos — ${subject}`,
    });
  });

  it('RN-10: a pendência alerts the client AND the analista ("disparo duplo")', () => {
    const messages = move('cadastro', 'processo_pendencia');
    expect(messages.map((m) => [m.recipientRole, m.to])).toEqual([
      ['cliente', 'helena@exemplo.dev'],
      ['analista', 'rafael@exemplo.dev'],
    ]);
    expect(messages[1].subject).toBe('Flui — pendência no processo de Helena');
    expect(messages[1].text).toContain('etapa anterior: Cadastro');
  });

  it('only the pendência reaches the analista', () => {
    for (const to of [
      'analise_credito',
      'assinatura',
      'credito_recusado',
    ] as ProcessStage[]) {
      expect(move('cadastro', to).map((m) => m.recipientRole)).toEqual([
        'cliente',
      ]);
    }
  });

  it('a refusal never says the process "advanced" (bug of the old e-mail)', () => {
    const [m] = move('analise_credito', 'credito_recusado');
    expect(m.subject).not.toMatch(/avançou/);
    expect(m.text).toContain('não foi aprovada pelo banco');
  });

  it('an undo tells the client the process went back', () => {
    const [m] = move('analise_credito', 'cadastro', true);
    expect(m.subject).toBe(
      'Flui Contratos — seu processo voltou para Cadastro',
    );
    expect(m.text).toContain(
      'voltou para a etapa Cadastro (correção feita pela assessoria)',
    );
  });

  it('no e-mail without an address', () => {
    expect(
      stageChangeMessages(
        {
          client: null,
          analista: null,
          clientName: null,
          fromStage: 'inicial',
          toStage: 'cadastro',
        },
        ctx,
      ),
    ).toEqual([]);
  });

  it('every message names the assessoria and links to the portal, in HTML and text', () => {
    const [m] = move('inicial', 'cadastro');
    expect(m.html).toContain(
      'Assessoria Exemplo acompanha o seu financiamento',
    );
    expect(m.html).toContain('href="https://app.exemplo.dev"');
    expect(m.text).toContain(
      'Assessoria Exemplo acompanha o seu financiamento',
    );
    expect(m.text).toContain('Acompanhar no portal: https://app.exemplo.dev');
    expect(m.text).toMatch(/^Olá, Helena!/);
  });
});

describe('documents', () => {
  it('documents_requested lists each requested document', () => {
    const m = documentsRequestedMessage(
      client,
      ['RG ou CNH', 'Holerite (mês 1)'],
      ctx,
    );
    expect(m).toMatchObject({
      eventType: 'documents_requested',
      to: 'helena@exemplo.dev',
      subject: 'Flui Contratos — documentos solicitados',
    });
    expect(m.text).toContain('• RG ou CNH\n• Holerite (mês 1)');
    expect(m.html).toContain('<li style="margin:4px 0">Holerite (mês 1)</li>');
  });

  it('document_rejected carries the analista note', () => {
    const m = documentRejectedMessage(client, 'RG', 'Foto ilegível', ctx);
    expect(m.subject).toBe(
      'Flui Contratos — documento "RG" precisa ser reenviado',
    );
    expect(m.text).toContain('Observação do analista:\nFoto ilegível');
  });

  it('text typed by users cannot inject markup into the e-mails', () => {
    const m = documentRejectedMessage(
      { name: 'Ana <b>', email: 'c@b.com' },
      'RG "frente"',
      '<a href="https://golpe.example">clique aqui</a>',
      { ...ctx, tenantName: 'Assessoria <script>' },
    );
    expect(m.html).not.toContain('<a href="https://golpe.example">');
    expect(m.html).toContain(
      '&lt;a href=&quot;https://golpe.example&quot;&gt;clique aqui&lt;/a&gt;',
    );
    expect(m.html).toContain('Ana &lt;b&gt;');
    expect(m.html).toContain('RG &quot;frente&quot;');
    expect(m.html).not.toContain('<script>');
  });
});
