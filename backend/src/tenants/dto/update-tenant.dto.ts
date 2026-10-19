import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value;

/**
 * PATCH /tenants/me (PROD-04). Only the name is editable by the gestor; slug,
 * active flag and plan belong to the Super Admin (outside the app). Any other
 * field in the body is rejected (forbidNonWhitelisted).
 */
export class UpdateTenantDto {
  @Transform(trim)
  @IsString({ message: 'Informe o nome da assessoria' })
  @MinLength(2, {
    message: 'O nome da assessoria precisa de pelo menos 2 caracteres',
  })
  @MaxLength(100, {
    message: 'O nome da assessoria pode ter no máximo 100 caracteres',
  })
  name: string;
}
