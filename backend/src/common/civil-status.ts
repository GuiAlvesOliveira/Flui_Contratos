// Estado civil e fonte de renda do proponente: os valores aceitos pela API e
// pelo banco (CHECK em processes e users) — os mesmos que as telas oferecem.
export const ESTADOS_CIVIS = [
  'solteiro',
  'casado',
  'divorciado',
  'viuvo',
  'uniao_estavel',
] as const;
export type EstadoCivil = (typeof ESTADOS_CIVIS)[number];

export const FONTES_RENDA = ['assalariado', 'nao_assalariado'] as const;
export type FonteRenda = (typeof FONTES_RENDA)[number];
