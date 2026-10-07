import { ValidateBy, ValidationOptions } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * FE-20: birth date as a real calendar day (YYYY-MM-DD) between 1900-01-01
 * and today. null/undefined are handled by @IsOptional (null clears the field).
 */
export function IsBirthDate(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isBirthDate',
      validator: {
        validate: (value: unknown) => {
          if (typeof value !== 'string' || !DATE_ONLY.test(value)) return false;
          const d = new Date(`${value}T00:00:00Z`);
          if (Number.isNaN(d.getTime())) return false;
          // Rejects impossible days that Date would roll over (e.g. 2001-02-30)
          if (d.toISOString().slice(0, 10) !== value) return false;
          const today = new Date().toISOString().slice(0, 10);
          return value >= '1900-01-01' && value <= today;
        },
        defaultMessage: () =>
          'dataNascimento deve ser uma data válida (AAAA-MM-DD) entre 1900 e hoje',
      },
    },
    options,
  );
}
