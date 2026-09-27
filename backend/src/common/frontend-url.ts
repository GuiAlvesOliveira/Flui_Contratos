const DEV_FRONTEND_URL = 'http://localhost:5173';

/**
 * FRONTEND_URL may list several origins, comma-separated (e.g. apex + www
 * domain), all of which CORS must accept.
 */
export function frontendOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((u) => u.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * Links sent to users (e.g. the invite redirect) need exactly one URL: the
 * first entry of FRONTEND_URL is the canonical app address.
 */
export function primaryFrontendUrl(raw: string | undefined): string {
  return frontendOrigins(raw)[0] ?? DEV_FRONTEND_URL;
}

// Per-deploy URLs of this Vercel project: flui-contratos-<hash>-<team>.vercel.app.
// The hash has no hyphens and the team slug is globally unique, so another
// Vercel account can't produce a URL that matches (unlike *.vercel.app).
const VERCEL_DEPLOY_URL =
  /^https:\/\/flui-contratos-[a-z0-9]+-fluicontratos-s-project\.vercel\.app$/;
const LOCALHOST = /^http:\/\/localhost:\d+$/;

/**
 * CORS allowlist (INFRA-12): the FRONTEND_URL origins plus this project's own
 * Vercel deploy URLs; localhost only outside production.
 */
export function corsOrigins(
  frontendUrl: string | undefined,
  nodeEnv: string | undefined,
): (string | RegExp)[] {
  const origins: (string | RegExp)[] = [
    ...frontendOrigins(frontendUrl),
    VERCEL_DEPLOY_URL,
  ];
  if (nodeEnv !== 'production') origins.push(LOCALHOST);
  return origins;
}
