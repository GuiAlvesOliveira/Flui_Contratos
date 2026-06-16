import { IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Whitelist for PATCH /users/:id/profile.
 * Intentionally excludes role, tenantId, active, externalId, onboardingCompleted
 * and mustChangePassword — those must NEVER be settable via a profile update
 * (mass-assignment / privilege-escalation guard, SEC-01).
 * Constraints kept lenient (no min-length) to preserve current edit behavior,
 * which allows clearing a field by sending an empty string.
 */
export class UpdateProfileDto {
  @IsOptional() @IsString()
  name?: string;

  @IsOptional() @IsString()
  surname?: string;

  @IsOptional() @IsString()
  cpf?: string;

  @IsOptional() @IsString()
  telefone?: string;

  /** Not persisted on the user — only used to attach an audit-log entry to a process. */
  @IsOptional() @IsUUID()
  processId?: string;
}
