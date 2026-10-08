import { IsString, Length } from 'class-validator';

/** Query string of GET /search (FE-30). */
export class SearchQueryDto {
  @IsString()
  @Length(3, 100, { message: 'a busca deve ter entre 3 e 100 caracteres' })
  q: string;
}
