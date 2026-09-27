import {
  corsOrigins,
  frontendOrigins,
  primaryFrontendUrl,
} from './frontend-url';

describe('frontend-url', () => {
  it('splits a comma-separated FRONTEND_URL into CORS origins', () => {
    expect(
      frontendOrigins(
        'https://fluicontratos.com.br, https://www.fluicontratos.com.br/',
      ),
    ).toEqual([
      'https://fluicontratos.com.br',
      'https://www.fluicontratos.com.br',
    ]);
  });

  it('uses only the first entry for links sent to users (invite redirect)', () => {
    expect(
      primaryFrontendUrl(
        'https://fluicontratos.com.br,https://www.fluicontratos.com.br',
      ),
    ).toBe('https://fluicontratos.com.br');
  });

  it('falls back to the local dev server when FRONTEND_URL is unset or empty', () => {
    expect(primaryFrontendUrl(undefined)).toBe('http://localhost:5173');
    expect(primaryFrontendUrl(' , ')).toBe('http://localhost:5173');
    expect(frontendOrigins(undefined)).toEqual([]);
  });
});

describe('corsOrigins (INFRA-12)', () => {
  const PROD_URLS =
    'https://fluicontratos.com.br,https://www.fluicontratos.com.br';
  // Same matching rule the `cors` package applies to an origin list.
  const allows = (list: (string | RegExp)[], origin: string) =>
    list.some((o) => (o instanceof RegExp ? o.test(origin) : o === origin));

  it('accepts the production domains from FRONTEND_URL', () => {
    const list = corsOrigins(PROD_URLS, 'production');
    expect(allows(list, 'https://fluicontratos.com.br')).toBe(true);
    expect(allows(list, 'https://www.fluicontratos.com.br')).toBe(true);
  });

  it("accepts this project's own Vercel deploy URLs", () => {
    const list = corsOrigins(PROD_URLS, 'production');
    expect(
      allows(
        list,
        'https://flui-contratos-60abns1ta-fluicontratos-s-project.vercel.app',
      ),
    ).toBe(true);
  });

  it('rejects any other *.vercel.app, including look-alike team slugs', () => {
    const list = corsOrigins(PROD_URLS, 'production');
    expect(allows(list, 'https://evil.vercel.app')).toBe(false);
    expect(
      allows(list, 'https://flui-contratos-abc123-attacker.vercel.app'),
    ).toBe(false);
    expect(
      allows(
        list,
        'https://flui-contratos-abc123-evil-fluicontratos-s-project.vercel.app',
      ),
    ).toBe(false);
  });

  it('allows localhost only outside production', () => {
    expect(
      allows(corsOrigins(PROD_URLS, 'production'), 'http://localhost:5173'),
    ).toBe(false);
    expect(
      allows(corsOrigins(undefined, 'development'), 'http://localhost:5173'),
    ).toBe(true);
  });
});
