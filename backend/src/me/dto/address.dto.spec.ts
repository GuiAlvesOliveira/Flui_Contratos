import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OnboardingDto } from './onboarding.dto';
import { UpdateProfileDto } from '../../users/dto/update-profile.dto';

// PROD-06: CEP and address on the onboarding and on PATCH /users/:id/profile,
// with the same options as the global ValidationPipe in main.ts.
async function errorsFor(cls: new () => object, body: Record<string, unknown>) {
  const errors = await validate(plainToInstance(cls, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

describe('CEP e endereço do cliente (PROD-06)', () => {
  it('onboarding aceita CEP com ou sem hífen e o endereço', async () => {
    for (const cep of ['01310-100', '01310100']) {
      expect(
        await errorsFor(OnboardingDto, {
          name: 'Ana',
          cep,
          endereco: 'Avenida Paulista, 1000, Bela Vista, São Paulo - SP',
        }),
      ).toEqual([]);
    }
  });

  it('onboarding recusa CEP sem 8 dígitos e endereço longo demais', async () => {
    for (const cep of ['0131010', '013101000', 'abcde-fgh', '']) {
      expect(await errorsFor(OnboardingDto, { name: 'Ana', cep })).toEqual([
        'cep',
      ]);
    }
    expect(
      await errorsFor(OnboardingDto, {
        name: 'Ana',
        endereco: 'x'.repeat(256),
      }),
    ).toEqual(['endereco']);
  });

  it('perfil aceita CEP vazio (limpa o campo) e recusa CEP inválido', async () => {
    expect(
      await errorsFor(UpdateProfileDto, { cep: '', endereco: '' }),
    ).toEqual([]);
    expect(await errorsFor(UpdateProfileDto, { cep: '01310-100' })).toEqual([]);
    expect(await errorsFor(UpdateProfileDto, { cep: '1234' })).toEqual(['cep']);
  });
});
