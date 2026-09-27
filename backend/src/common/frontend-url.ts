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
