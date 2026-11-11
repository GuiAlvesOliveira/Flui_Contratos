// Paleta de cores do sistema, escolhida pelo gestor de cada assessoria em
// Configurações. A API guarda só o identificador; as cores em si vivem no
// frontend (blocos [data-theme] em frontend/src/styles/design.css e a lista em
// frontend/src/lib/theme.ts). Mantenha os três em sincronia.
export const TENANT_THEMES = [
  'floresta',
  'violeta',
  'oceano',
  'marinho',
  'petroleo',
  'vinho',
  'terracota',
  'grafite',
] as const;

export type TenantTheme = (typeof TENANT_THEMES)[number];

export const DEFAULT_TENANT_THEME: TenantTheme = 'floresta';

// Nome exibido no Log de Ações ("De → Para").
export const TENANT_THEME_LABELS: Record<TenantTheme, string> = {
  floresta: 'Floresta',
  violeta: 'Violeta',
  oceano: 'Oceano',
  marinho: 'Marinho',
  petroleo: 'Petróleo',
  vinho: 'Vinho',
  terracota: 'Terracota',
  grafite: 'Grafite',
};

export function isTenantTheme(value: unknown): value is TenantTheme {
  return (
    typeof value === 'string' &&
    (TENANT_THEMES as readonly string[]).includes(value)
  );
}
