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
