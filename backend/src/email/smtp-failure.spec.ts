import { smtpFailureReason } from './smtp-failure';

describe('smtpFailureReason', () => {
  it('SMTP not configured: says which settings are missing', () => {
    expect(
      smtpFailureReason(
        new Error(
          'SMTP não configurado — defina SMTP_HOST, SMTP_USER e SMTP_PASS',
        ),
      ),
    ).toMatch(/não está configurado no servidor/);
  });

  it('Brevo blocking the server IP is not reported as a wrong password', () => {
    const reason = smtpFailureReason({
      code: 'EAUTH',
      responseCode: 525,
      response: '525 5.7.1 Unauthorized IP address',
      message: 'Invalid login: 525 5.7.1 Unauthorized IP address',
    });
    expect(reason).toMatch(/recusou o endereço IP/);
    expect(reason).toMatch(/IPs autorizados/);
    expect(reason).not.toMatch(/senha/);
  });

  it('wrong user or password', () => {
    expect(
      smtpFailureReason({
        code: 'EAUTH',
        responseCode: 535,
        response: '535 5.7.8 Authentication failed',
      }),
    ).toMatch(/usuário ou a senha/);
  });

  it.each(['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS', 'ECONNREFUSED'])(
    'network failure (%s) points to host, port and network',
    (code) => {
      expect(smtpFailureReason({ code, message: 'boom' })).toMatch(
        /Não foi possível conectar/,
      );
    },
  );

  it('a refused sender or recipient shows what the server answered, in one line', () => {
    const reason = smtpFailureReason({
      code: 'EENVELOPE',
      responseCode: 550,
      response: '550 5.7.1 Sender   not valid\nsecond line',
    });
    expect(reason).toBe(
      'O servidor de e-mail recusou o remetente ou o destinatário: 550 5.7.1 Sender not valid',
    );
  });

  it('anything else keeps the original message, shortened', () => {
    expect(smtpFailureReason(new Error('x'.repeat(500)))).toHaveLength(
      'Falha no envio: '.length + 200,
    );
    expect(smtpFailureReason(undefined)).toBe(
      'Falha no envio: motivo não informado',
    );
  });
});
