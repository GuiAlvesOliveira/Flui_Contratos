import { IsUUID } from 'class-validator';

/** Body of POST /empreendimentos/:id/team (FE-27). */
export class AddTeamMemberDto {
  @IsUUID()
  userId: string;
}
