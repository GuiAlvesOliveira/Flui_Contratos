import {
  financingSql,
  monthLabel,
  monthTotals,
  PLAN_BPS,
  planRateSql,
  type SignedContract,
  successFee,
  successFeeCsv,
} from './success-fee';

const contract = (over: Partial<SignedContract>): SignedContract => ({
  processId: 'p1',
  signedAt: '2026-10-19T15:00:00.000Z',
  month: '2026-10',
  clientName: 'Helena',
  analistaName: 'Ana',
  financing: 350000,
  commission: 7000,
  rate: 0.015,
  fee: 105,
  ...over,
});

describe('success fee (PROD-09)', () => {
  it('taxas dos planos: Essencial 1,5%, Profissional 1,0%, Escala 0,5%', () => {
    expect(PLAN_BPS).toEqual({ essencial: 150, profissional: 100, escala: 50 });
    expect(planRateSql('t.plano')).toBe(
      "(CASE t.plano WHEN 'escala' THEN 0.005 WHEN 'profissional' THEN 0.010 ELSE 0.015 END)",
    );
  });

  it('incide sobre a comissão da assessoria, não sobre o financiamento', () => {
    // R$ 350 mil financiados × 2% = R$ 7.000 de comissão → fee de R$ 35 a R$ 105
    expect(successFee(7000, 0.015)).toBe(105);
    expect(successFee(7000, 0.01)).toBe(70);
    expect(successFee(7000, 0.005)).toBe(35);
  });

  it.each([
    [7333.33, 0.015, 110], // 109,99995 → 110,00
    [1234.5, 0.005, 6.17], // 6,1725 → 6,17
    [1234.7, 0.005, 6.17], // 6,1735 → 6,17
    [1235.0, 0.005, 6.18], // 6,175 → 6,18 (meio centavo arredonda para cima)
    [0.01, 0.005, 0], // 0,00005 → 0,00
    [0.1, 0.015, 0], // 0,0015 → 0,00
    [3.33, 0.015, 0.05], // 0,04995 → 0,05
    [1999999.99, 0.015, 30000], // 29.999,99985 → 30.000,00
  ])('arredonda em centavos: %d × %d = %d', (commission, rate, fee) => {
    expect(successFee(commission, rate)).toBe(fee);
  });

  it('valor do financiamento: formulário de financiamento, senão o valor em aberto', () => {
    const sql = financingSql('p');
    expect(sql).toContain("d.form_type = 'financiamento'");
    expect(sql).toContain("(d.form_data->>'valorFinanciado')::numeric");
    expect(sql).toContain('p.valor_em_aberto)');
  });

  it('totais por mês: 12 meses, comissão e fee somados em centavos, pendentes contados', () => {
    const months = monthTotals(2026, [
      contract({ commission: 0.1, fee: 0.01 }),
      contract({ processId: 'p2', commission: 0.2, fee: 0.02 }),
      contract({ processId: 'p3', commission: null, fee: null }),
      contract({
        processId: 'p4',
        month: '2026-03',
        commission: 5600,
        fee: 84,
      }),
    ]);
    expect(months).toHaveLength(12);
    expect(months[9]).toEqual({
      month: '2026-10',
      contracts: 3,
      commission: 0.3,
      fee: 0.03,
      pending: 1,
    });
    expect(months[2]).toEqual({
      month: '2026-03',
      contracts: 1,
      commission: 5600,
      fee: 84,
      pending: 0,
    });
    expect(months[0]).toEqual({
      month: '2026-01',
      contracts: 0,
      commission: 0,
      fee: 0,
      pending: 0,
    });
    expect(monthLabel('2026-03')).toBe('março/2026');
  });

  it('CSV para o Excel: BOM, ponto e vírgula, vírgula decimal, "a informar" e total', () => {
    const list = [
      contract({}),
      contract({
        processId: 'p2',
        clientName: '=HYPERLINK("x")',
        commission: null,
        fee: null,
        analistaName: null,
      }),
    ];
    const csv = successFeeCsv(list, monthTotals(2026, list));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'Mês;Assinado em;Cliente;Analista;Valor do financiamento (R$);Comissão da assessoria (R$);Taxa da Flui;Success fee (R$)',
    );
    expect(lines[1]).toBe(
      'outubro/2026;19/10/2026;Helena;Ana;350000,00;7000,00;1,5%;105,00',
    );
    // célula começando com "=" não vira fórmula
    expect(lines[2]).toBe(
      `outubro/2026;19/10/2026;"'=HYPERLINK(""x"")";;350000,00;a informar;1,5%;`,
    );
    expect(lines[3]).toBe('Total;2 contrato(s);;;;7000,00;;105,00');
  });
});
