import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OnboardingDto } from './onboarding.dto';

// Ficha do cliente: estado civil e fonte de renda chegam na API (antes a tela
// pedia e descartava), com as mesmas opções do ValidationPipe global (main.ts).
const errorsFor = async (body: Record<string, unknown>) =>
  (
    await validate(plainToInstance(OnboardingDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  ).map((e) => e.property);

describe('OnboardingDto — estado civil e fonte de renda', () => {
  it.each(['solteiro', 'casado', 'divorciado', 'viuvo', 'uniao_estavel'])(
    'aceita o estado civil %s',
    async (estadoCivil) => {
      expect(
        await errorsFor({
          name: 'Helena',
          estadoCivil,
          fonteRenda: 'assalariado',
        }),
      ).toEqual([]);
    },
  );

  it('aceita as duas fontes de renda; os dois campos são opcionais', async () => {
    expect(
      await errorsFor({ name: 'Helena', fonteRenda: 'nao_assalariado' }),
    ).toEqual([]);
    expect(await errorsFor({ name: 'Helena' })).toEqual([]);
  });

  it('recusa valores fora da lista', async () => {
    expect(
      await errorsFor({
        name: 'Helena',
        estadoCivil: 'noivo',
        fonteRenda: 'outra',
      }),
    ).toEqual(['estadoCivil', 'fonteRenda']);
  });
});
