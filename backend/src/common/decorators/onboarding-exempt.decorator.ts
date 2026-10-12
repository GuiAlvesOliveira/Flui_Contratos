import { SetMetadata } from '@nestjs/common';

export const ONBOARDING_EXEMPT_KEY = 'onboardingExempt';

/**
 * AUTH-08: marks a route as reachable by an analista/cliente who has not
 * completed the onboarding yet. Apply ONLY to the routes the onboarding itself
 * needs (GET /me, PATCH /me/change-password, PATCH /me/onboarding); every other
 * route is blocked by the TenantGuard until the basic data is filled in.
 */
export const OnboardingExempt = () => SetMetadata(ONBOARDING_EXEMPT_KEY, true);
