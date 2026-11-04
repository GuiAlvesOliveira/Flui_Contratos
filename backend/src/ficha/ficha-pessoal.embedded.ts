import { Column } from 'typeorm';

// Ficha completa (dados que os formulários do banco pedem), embutida com as
// mesmas colunas em `users` (cliente) e `process_participants` (2º comprador
// ou cônjuge). Lista e validação em ficha-fields.ts.
export class FichaPessoal {
  @Column({ type: 'varchar', length: 60, nullable: true })
  nacionalidade: string | null;

  @Column({
    type: 'varchar',
    name: 'naturalidade_cidade',
    length: 120,
    nullable: true,
  })
  naturalidadeCidade: string | null;

  @Column({
    type: 'varchar',
    name: 'naturalidade_uf',
    length: 2,
    nullable: true,
  })
  naturalidadeUf: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  genero: 'feminino' | 'masculino' | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  profissao: string | null;

  @Column({ type: 'boolean', name: 'empregador_inss', nullable: true })
  empregadorInss: boolean | null;

  @Column({
    type: 'varchar',
    name: 'documento_tipo',
    length: 5,
    nullable: true,
  })
  documentoTipo: string | null;

  @Column({ type: 'date', name: 'documento_emissao', nullable: true })
  documentoEmissao: string | null;

  @Column({
    type: 'varchar',
    name: 'documento_orgao',
    length: 30,
    nullable: true,
  })
  documentoOrgao: string | null;

  @Column({ type: 'varchar', name: 'documento_uf', length: 2, nullable: true })
  documentoUf: string | null;

  @Column({
    type: 'varchar',
    name: 'estado_civil_registro',
    length: 25,
    nullable: true,
  })
  estadoCivilRegistro: string | null;

  @Column({ type: 'date', name: 'data_casamento', nullable: true })
  dataCasamento: string | null;

  @Column({ type: 'varchar', name: 'regime_bens', length: 30, nullable: true })
  regimeBens: string | null;

  @Column({ type: 'varchar', name: 'filiacao_1', length: 255, nullable: true })
  filiacao1: string | null;

  @Column({ type: 'varchar', name: 'filiacao_2', length: 255, nullable: true })
  filiacao2: string | null;

  @Column({
    type: 'varchar',
    name: 'telefone_residencial',
    length: 20,
    nullable: true,
  })
  telefoneResidencial: string | null;

  @Column({
    type: 'varchar',
    name: 'telefone_comercial',
    length: 20,
    nullable: true,
  })
  telefoneComercial: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  logradouro: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  numero: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  complemento: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  bairro: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  cidade: string | null;

  @Column({ type: 'varchar', length: 2, nullable: true })
  uf: string | null;
}

/** colunas SQL do embutido, na ordem das propriedades (migration e testes) */
export const FICHA_PESSOAL_COLUMNS: [column: string, sqlType: string][] = [
  ['nacionalidade', 'VARCHAR(60)'],
  ['naturalidade_cidade', 'VARCHAR(120)'],
  ['naturalidade_uf', 'VARCHAR(2)'],
  ['genero', "VARCHAR(10) CHECK (genero IN ('feminino', 'masculino'))"],
  ['profissao', 'VARCHAR(120)'],
  ['empregador_inss', 'BOOLEAN'],
  [
    'documento_tipo',
    "VARCHAR(5) CHECK (documento_tipo IN ('rg', 'rne', 'oab', 'crm', 'crea', 'cnh'))",
  ],
  ['documento_emissao', 'DATE'],
  ['documento_orgao', 'VARCHAR(30)'],
  ['documento_uf', 'VARCHAR(2)'],
  [
    'estado_civil_registro',
    "VARCHAR(25) CHECK (estado_civil_registro IN ('solteiro', 'divorciado', 'viuvo', 'separado_judicialmente', 'desquitado'))",
  ],
  ['data_casamento', 'DATE'],
  [
    'regime_bens',
    "VARCHAR(30) CHECK (regime_bens IN ('comunhao_parcial', 'comunhao_universal', 'separacao_total', 'participacao_final_aquestos', 'separacao_obrigatoria'))",
  ],
  ['filiacao_1', 'VARCHAR(255)'],
  ['filiacao_2', 'VARCHAR(255)'],
  ['telefone_residencial', 'VARCHAR(20)'],
  ['telefone_comercial', 'VARCHAR(20)'],
  ['logradouro', 'VARCHAR(255)'],
  ['numero', 'VARCHAR(20)'],
  ['complemento', 'VARCHAR(120)'],
  ['bairro', 'VARCHAR(120)'],
  ['cidade', 'VARCHAR(120)'],
  ['uf', 'VARCHAR(2)'],
];
