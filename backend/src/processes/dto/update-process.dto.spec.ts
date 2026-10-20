import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProcessDto } from './update-process.dto';

// PROD-09: a comissão da assessoria entra no PATCH /processes/:id
const errorsOf = async (body: object) =>
  (await validate(plainToInstance(UpdateProcessDto, body))).map(
    (e) => e.property,
  );

describe('UpdateProcessDto — comissão da assessoria (PROD-09)', () => {
  it('aceita reais com até 2 casas, zero e null (limpa)', async () => {
    expect(await errorsOf({ comissaoAssessoria: 7000 })).toEqual([]);
    expect(await errorsOf({ comissaoAssessoria: 7333.33 })).toEqual([]);
    expect(await errorsOf({ comissaoAssessoria: 0 })).toEqual([]);
    expect(await errorsOf({ comissaoAssessoria: null })).toEqual([]);
  });

  it.each([[-1], [10.123], ['7000'], [1e16]])('recusa %p', async (v) => {
    expect(await errorsOf({ comissaoAssessoria: v })).toEqual([
      'comissaoAssessoria',
    ]);
  });
});

const messagesOf = async (body: object) =>
  (await validate(plainToInstance(UpdateProcessDto, body))).flatMap((e) =>
    Object.values(e.constraints ?? {}),
  );

describe('UpdateProcessDto — uma mensagem por problema na comissão', () => {
  it.each([
    ['7000', 'A comissão deve ser um número em reais'],
    [-1, 'A comissão não pode ser negativa'],
    [10.123, 'A comissão aceita até 2 casas decimais'],
    [1e16, 'A comissão está acima do limite'],
  ])('%p → %s', async (v, message) => {
    expect(await messagesOf({ comissaoAssessoria: v })).toEqual([message]);
  });
});

describe('UpdateProcessDto — estado civil e fonte de renda', () => {
  it.each(['solteiro', 'casado', 'divorciado', 'viuvo', 'uniao_estavel'])(
    'aceita o estado civil %s (o mesmo que a tela oferece)',
    async (estadoCivil) => {
      expect(await errorsOf({ estadoCivil })).toEqual([]);
    },
  );

  it('recusa valores fora da lista; null limpa', async () => {
    expect(await errorsOf({ estadoCivil: 'noivo' })).toEqual(['estadoCivil']);
    expect(await errorsOf({ fonteRenda: 'outra' })).toEqual(['fonteRenda']);
    expect(await errorsOf({ estadoCivil: null, fonteRenda: null })).toEqual([]);
  });
});
