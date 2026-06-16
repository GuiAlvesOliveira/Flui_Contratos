import { SetMetadata } from '@nestjs/common';

export const PASSWORD_CHANGE_EXEMPT_KEY = 'passwordChangeExempt';

/**
 * Marks a route as reachable even while the authenticated user still has
 * mustChangePassword = true. Apply ONLY to GET /me and PATCH /me/change-password
 * so a user forced to rotate their initial password can read their own state and
 * set a new one. Every other route is blocked by the TenantGuard until the
 * password is changed (SEC-03).
 */
export const PasswordChangeExempt = () =>
  SetMetadata(PASSWORD_CHANGE_EXEMPT_KEY, true);
