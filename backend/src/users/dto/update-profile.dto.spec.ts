import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';
import { OnboardingDto } from '../../me/dto/onboarding.dto';

// Same options as the global ValidationPipe in main.ts.
async function errorsFor<T extends object>(
  cls: new () => T,
  body: Record<string, unknown>,
) {
  const errors = await validate(plainToInstance(cls, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

describe('UpdateProfileDto — ficha cadastral (FE-20)', () => {
  it('accepts name, surname, CPF, RG, phone and birth date', async () => {
    expect(
      await errorsFor(UpdateProfileDto, {
        name: 'Helena',
        surname: 'Narduci',
        cpf: '52998224725',
        rg: '12.345.678-9',
        telefone: '11987654321',
        dataNascimento: '1990-05-17',
      }),
    ).toEqual([]);
  });

  it('accepts null to clear the birth date', async () => {
    expect(await errorsFor(UpdateProfileDto, { dataNascimento: null })).toEqual(
      [],
    );
  });

  it.each([
    ['17/05/1990'],
    ['1990-02-30'],
    ['1899-12-31'],
    ['2999-01-01'],
    [''],
  ])('rejects the birth date %p', async (value) => {
    expect(
      await errorsFor(UpdateProfileDto, { dataNascimento: value }),
    ).toEqual(['dataNascimento']);
  });

  it('still refuses role/tenant/status (mass assignment guard)', async () => {
    expect(
      await errorsFor(UpdateProfileDto, { role: 'dono', tenantId: 'x' }),
    ).toEqual(['role', 'tenantId']);
  });

  it('onboarding accepts the birth date the form already asks for', async () => {
    expect(
      await errorsFor(OnboardingDto, {
        name: 'Helena',
        dataNascimento: '1990-05-17',
      }),
    ).toEqual([]);
    expect(
      await errorsFor(OnboardingDto, {
        name: 'Helena',
        dataNascimento: '2999-01-01',
      }),
    ).toEqual(['dataNascimento']);
  });
});
