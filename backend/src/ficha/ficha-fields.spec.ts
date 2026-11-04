import { getMetadataArgsStorage } from 'typeorm';
import { ESTADOS_CIVIS } from '../common/civil-status';
import {
  ESTADO_CIVIL_OPTIONS,
  FICHA_FIELDS,
  FICHA_GROUPS,
  fichaLabel,
  parseFichaKey,
} from './ficha-fields';
import { FICHA_PESSOAL_COLUMNS, FichaPessoal } from './ficha-pessoal.embedded';
import { normalizeFichaValue } from './ficha-values';

const field = (key: string) => FICHA_FIELDS.find((f) => f.key === key)!;
const norm = (key: string, v: unknown) => normalizeFichaValue(field(key), v);

describe('Ficha completa — campos', () => {
  it('as chaves dizem de quem é o dado; campo de processo não vale para pessoa e vice-versa', () => {
    expect(parseFichaKey('cliente.genero')?.target).toBe('cliente');
    expect(parseFichaKey('segundo.regimeBens')?.field.key).toBe('regimeBens');
    expect(parseFichaKey('processo.usaFgts')?.field.key).toBe('usaFgts');
    expect(parseFichaKey('processo.genero')).toBeNull();
    expect(parseFichaKey('cliente.usaFgts')).toBeNull();
    expect(parseFichaKey('cliente.inexistente')).toBeNull();
    expect(parseFichaKey('outro.genero')).toBeNull();
    expect(parseFichaKey('cliente.genero.x')).toBeNull();
  });

  it('o e-mail do cliente é o login e não entra na ficha; o do 2º comprador entra', () => {
    expect(parseFichaKey('cliente.email')).toBeNull();
    expect(parseFichaKey('segundo.email')).not.toBeNull();
  });

  it('rótulos dos pedidos identificam o 2º comprador', () => {
    expect(fichaLabel('cliente.filiacao1')).toBe('Nome da mãe ou do pai (1)');
    expect(fichaLabel('segundo.profissao')).toBe(
      '2º comprador: Profissão ou principal atividade',
    );
  });

  it('todo campo pertence a um grupo conhecido e as chaves não se repetem', () => {
    const groups = new Set(FICHA_GROUPS.map((g) => g.id));
    expect(FICHA_FIELDS.every((f) => groups.has(f.group))).toBe(true);
    expect(new Set(FICHA_FIELDS.map((f) => f.key)).size).toBe(
      FICHA_FIELDS.length,
    );
  });

  it('o estado civil da ficha usa as mesmas opções que a API já aceita', () => {
    expect(ESTADO_CIVIL_OPTIONS.map((o) => o.value)).toEqual([
      ...ESTADOS_CIVIS,
    ]);
  });

  it('as colunas da migration batem com as do embutido FichaPessoal', () => {
    const cols = getMetadataArgsStorage()
      .columns.filter((c) => c.target === FichaPessoal)
      .map((c) => c.options.name ?? c.propertyName);
    expect(cols).toEqual(FICHA_PESSOAL_COLUMNS.map(([c]) => c));
  });
});

describe('Ficha completa — validação dos valores', () => {
  it('vazio limpa o campo', () => {
    expect(norm('profissao', '  ')).toEqual({ value: null });
    expect(norm('usaFgts', null)).toEqual({ value: null });
  });

  it('texto é aparado e respeita o tamanho', () => {
    expect(norm('profissao', '  Engenheira   civil ')).toEqual({
      value: 'Engenheira civil',
    });
    expect(norm('documentoOrgao', 'x'.repeat(31))).toHaveProperty('error');
  });

  it('datas: reais, a partir de 1900 e nunca no futuro', () => {
    expect(norm('dataCasamento', '2015-02-28')).toEqual({
      value: '2015-02-28',
    });
    expect(norm('dataCasamento', '2015-02-30')).toHaveProperty('error');
    expect(norm('dataCasamento', '1899-12-31')).toHaveProperty('error');
    expect(norm('dataCasamento', '2999-01-01')).toHaveProperty('error');
    expect(norm('dataCasamento', '28/02/2015')).toHaveProperty('error');
  });

  it('opções, UF, CEP, telefone, e-mail, percentual e números', () => {
    expect(norm('regimeBens', 'comunhao_parcial')).toEqual({
      value: 'comunhao_parcial',
    });
    expect(norm('regimeBens', 'outro')).toHaveProperty('error');
    expect(norm('uf', 'sp')).toEqual({ value: 'SP' });
    expect(norm('uf', 'XX')).toHaveProperty('error');
    expect(norm('cep', '01310-100')).toEqual({ value: '01310100' });
    expect(norm('cep', '0131')).toHaveProperty('error');
    expect(norm('telefoneComercial', '(11) 3333-4444')).toEqual({
      value: '1133334444',
    });
    expect(norm('telefoneComercial', '3333-4444')).toHaveProperty('error');
    expect(norm('email', ' Ana@Exemplo.dev ')).toEqual({
      value: 'ana@exemplo.dev',
    });
    expect(norm('email', 'ana@')).toHaveProperty('error');
    expect(norm('percentualAquisicao1', '50,5')).toEqual({ value: 50.5 });
    expect(norm('percentualAquisicao1', 0)).toHaveProperty('error');
    expect(norm('percentualAquisicao1', 101)).toHaveProperty('error');
    expect(norm('bancoAgencia', '0123-4')).toEqual({ value: '01234' });
    expect(norm('primeiraCompraSfh', 'sim')).toHaveProperty('error');
    expect(norm('primeiraCompraSfh', false)).toEqual({ value: false });
  });

  it('a mensagem de erro cita o campo', () => {
    expect(norm('cep', '1')).toEqual({ error: 'CEP: o CEP tem 8 dígitos' });
  });
});
