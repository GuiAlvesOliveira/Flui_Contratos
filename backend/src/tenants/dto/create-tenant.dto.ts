import { IsString, Length } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @Length(1, 255)
  name: string;

  @IsString()
  @Length(1, 100)
  slug: string;
}
