import {
  computeValidUntil,
  currentMonthInSaoPaulo,
  daysUntil,
  documentValidity,
  dueText,
  EXPIRING_DAYS,
  formatDateBr,
  formatMonthBr,
  isFutureMonth,
  parseReferenceMonth,
  todayInSaoPaulo,
  validityStatus,
} from './document-validity';

describe('Validade pelo mês de referência — cálculo do vencimento', () => {
  it('exemplo da regra: holerite de 03/2026 com 3 meses vale até 30/06/2026', () => {
    expect(computeValidUntil('2026-03', 3)).toBe('2026-06-30');
  });

  it.each([
    // [mês de referência, validade, vale até]
    ['2026-11', 3, '2027-02-28'], // virada de ano, fevereiro de 28 dias
    ['2026-12', 1, '2027-01-31'], // virada de ano, mês de 31 dias
    ['2026-10', 3, '2027-01-31'],
    ['2026-07', 6, '2027-01-31'],
    ['2027-11', 3, '2028-02-29'], // fevereiro de ano bissexto
    ['2026-12', 14, '2028-02-29'], // mais de um ano de validade
    ['2026-01', 1, '2026-02-28'], // termina em mês de 28 dias
    ['2026-01', 3, '2026-04-30'], // termina em mês de 30 dias
    ['2026-02', 3, '2026-05-31'], // termina em mês de 31 dias
    ['2026-05', 1, '2026-06-30'], // 31 → 30 dias
    ['2026-06', 1, '2026-07-31'], // 30 → 31 dias
    ['2026-08', 6, '2027-02-28'], // extrato bancário (6 meses) virando o ano
  ])('%s + %i mês(es) vale até %s', (ref, months, until) => {
    expect(computeValidUntil(ref, months)).toBe(until);
  });

  it('aceita o mês no formato MM/AAAA', () => {
    expect(computeValidUntil('03/2026', 3)).toBe('2026-06-30');
  });

  it('recusa mês ou validade inválidos', () => {
    expect(() => computeValidUntil('2026-13', 3)).toThrow();
    expect(() => computeValidUntil('março', 3)).toThrow();
    expect(() => computeValidUntil('2026-03', 0)).toThrow();
    expect(() => computeValidUntil('2026-03', 1.5)).toThrow();
  });
});

describe('Validade — mês de referência informado', () => {
  it.each([
    ['2026-03', '2026-03'],
    ['03/2026', '2026-03'],
    [' 11/2026 ', '2026-11'],
    ['2026-3', null],
    ['13/2026', null],
    ['00/2026', null],
    ['2026-00', null],
    ['0012-05', null],
    ['', null],
    [undefined, null],
    [202603, null],
  ])('parseReferenceMonth(%p) = %p', (raw, expected) => {
    expect(parseReferenceMonth(raw)).toBe(expected);
  });

  it('mês futuro é o que vem depois do mês corrente de São Paulo', () => {
    const now = new Date('2026-11-10T15:00:00Z');
    expect(isFutureMonth('2026-11', now)).toBe(false);
    expect(isFutureMonth('2026-10', now)).toBe(false);
    expect(isFutureMonth('2026-12', now)).toBe(true);
    expect(isFutureMonth('2027-01', now)).toBe(true);
  });

  it('o "hoje" e o mês corrente seguem o fuso de São Paulo, não o UTC do servidor', () => {
    // 30/11 às 23h30 em São Paulo já é 01/12 em UTC
    const now = new Date('2026-12-01T02:30:00Z');
    expect(todayInSaoPaulo(now)).toBe('2026-11-30');
    expect(currentMonthInSaoPaulo(now)).toBe('2026-11');
    expect(isFutureMonth('2026-12', now)).toBe(true);
    // virada do ano
    const newYear = new Date('2027-01-01T03:00:00Z');
    expect(todayInSaoPaulo(newYear)).toBe('2027-01-01');
    expect(isFutureMonth('2027-01', newYear)).toBe(false);
  });
});

describe('Validade — situação do documento', () => {
  const until = '2026-06-30';

  it('vale até o dia do vencimento, inclusive; vencido a partir do dia seguinte', () => {
    expect(validityStatus(until, '2026-06-30')).toBe('vencendo');
    expect(daysUntil(until, '2026-06-30')).toBe(0);
    expect(validityStatus(until, '2026-07-01')).toBe('vencido');
    expect(daysUntil(until, '2026-07-01')).toBe(-1);
  });

  it(`vencendo = faltam ${EXPIRING_DAYS} dias ou menos`, () => {
    expect(validityStatus(until, '2026-06-14')).toBe('valido'); // 16 dias
    expect(validityStatus(until, '2026-06-15')).toBe('vencendo'); // 15 dias
    expect(daysUntil(until, '2026-06-15')).toBe(15);
    expect(validityStatus(until, '2026-03-01')).toBe('valido');
  });

  it('conta os dias pelo calendário (meses de 28, 30 e 31 dias e virada de ano)', () => {
    expect(daysUntil('2027-02-28', '2027-02-13')).toBe(15);
    expect(daysUntil('2027-01-31', '2026-12-31')).toBe(31);
    expect(daysUntil('2028-02-29', '2028-02-14')).toBe(15);
    expect(daysUntil('2026-03-01', '2026-02-28')).toBe(1);
  });

  it('texto do prazo', () => {
    expect(dueText(until, '2026-06-15')).toBe('vence em 15 dias');
    expect(dueText(until, '2026-06-29')).toBe('vence amanhã');
    expect(dueText(until, '2026-06-30')).toBe('vence hoje');
  });

  it('datas no formato brasileiro', () => {
    expect(formatDateBr('2026-06-30')).toBe('30/06/2026');
    expect(formatMonthBr('2026-03')).toBe('03/2026');
    expect(formatMonthBr('2026-03-01')).toBe('03/2026');
  });

  it('documento validado com mês de referência: situação e dias restantes', () => {
    expect(
      documentValidity(
        { status: 'validado', validUntil: until },
        3,
        '2026-06-20',
      ),
    ).toEqual({
      typeValidityMonths: 3,
      validityStatus: 'vencendo',
      daysLeft: 10,
    });
    expect(
      documentValidity(
        { status: 'validado', validUntil: until },
        3,
        '2026-07-02',
      ),
    ).toEqual({
      typeValidityMonths: 3,
      validityStatus: 'vencido',
      daysLeft: -2,
    });
  });

  it('documento validado antes da regra (sem mês) nunca vence sozinho: "sem_referencia"', () => {
    expect(
      documentValidity(
        { status: 'validado', validUntil: null },
        3,
        '2030-01-01',
      ),
    ).toEqual({
      typeValidityMonths: 3,
      validityStatus: 'sem_referencia',
      daysLeft: null,
    });
  });

  it('ainda não validado: só informa que o tipo pede mês de referência', () => {
    expect(
      documentValidity(
        { status: 'recebido', validUntil: null },
        6,
        '2026-06-20',
      ),
    ).toEqual({ typeValidityMonths: 6, validityStatus: null, daysLeft: null });
  });

  it('tipo sem validade (RG, CPF) e sem mês: nada a mostrar', () => {
    expect(
      documentValidity(
        { status: 'validado', validUntil: null },
        null,
        '2026-06-20',
      ),
    ).toBeNull();
    expect(
      documentValidity(
        { status: 'pendente', validUntil: null },
        null,
        '2026-06-20',
      ),
    ).toBeNull();
  });
});
