import { IsIn } from 'class-validator';

/**
 * PATCH /users/:id/status — enable or disable an account (SEC-02).
 * `invited` is not settable: it only exists until the user's first login.
 */
export class UpdateUserStatusDto {
  @IsIn(['active', 'disabled'])
  status: 'active' | 'disabled';
}
