// Traduz a falha do servidor SMTP para o que o gestor precisa fazer. O teste
// de e-mail do Log de Ações mostra este texto, em vez de um "falha no envio"
// que não diz se o problema é senha, rede, remetente ou bloqueio do provedor.
interface SmtpError {
  code?: string;
  responseCode?: number;
  response?: string;
  message?: string;
}

export function smtpFailureReason(err: unknown): string {
  const e = (err ?? {}) as SmtpError;
  const text = `${e.response ?? ''} ${e.message ?? ''}`;

  if (/SMTP não configurado/i.test(text)) {
    return 'O envio de e-mail não está configurado no servidor (SMTP_HOST, SMTP_USER e SMTP_PASS).';
  }
  // Brevo: a conta só aceita conexões dos IPs autorizados no painel
  if (e.responseCode === 525 || /unauthori[sz]ed ip/i.test(text)) {
    return 'O provedor de e-mail recusou o endereço IP do servidor. No Brevo, autorize o IP em Segurança → IPs autorizados (ou desative o bloqueio de IPs desconhecidos) e tente de novo.';
  }
  if (e.code === 'EAUTH' || e.responseCode === 535) {
    return 'O servidor de e-mail recusou o usuário ou a senha (SMTP_USER / SMTP_PASS).';
  }
  if (
    e.code === 'ETIMEDOUT' ||
    e.code === 'ECONNECTION' ||
    e.code === 'ESOCKET' ||
    e.code === 'EDNS' ||
    e.code === 'ECONNREFUSED'
  ) {
    return 'Não foi possível conectar ao servidor de e-mail (confira SMTP_HOST, SMTP_PORT e a rede do servidor).';
  }
  if (e.code === 'EENVELOPE' || (e.responseCode ?? 0) >= 550) {
    return `O servidor de e-mail recusou o remetente ou o destinatário: ${clean(e.response ?? e.message)}`;
  }
  return `Falha no envio: ${clean(e.message ?? e.response)}`;
}

// Uma linha só, sem o que não ajuda quem lê (e nunca mais que 200 caracteres).
function clean(value: string | undefined): string {
  return (value ?? 'motivo não informado')
    .split('\n')[0]
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}
