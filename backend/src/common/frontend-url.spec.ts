import { frontendOrigins, primaryFrontendUrl } from './frontend-url';

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
