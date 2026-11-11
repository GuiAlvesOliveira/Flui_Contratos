// Paleta de cores do sistema. O gestor escolhe em Configurações e a escolha
// vale para toda a assessoria (GET /tenants/me → themeColor). As cores de cada
// tema estão nos blocos [data-theme] de styles/design.css; aqui ficam só os
// identificadores e os nomes. Espelha backend/src/tenants/tenant-theme.ts.

export const THEMES = [
  { id: 'floresta', label: 'Floresta' },
  { id: 'violeta', label: 'Violeta' },
  { id: 'oceano', label: 'Oceano' },
  { id: 'marinho', label: 'Marinho' },
  { id: 'petroleo', label: 'Petróleo' },
  { id: 'vinho', label: 'Vinho' },
  { id: 'terracota', label: 'Terracota' },
  { id: 'grafite', label: 'Grafite' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME: ThemeId = 'floresta';

const STORAGE_KEY = 'flui_theme';

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some(t => t.id === value);
}

// Troca a cor da tela inteira e guarda a escolha neste navegador, para a
// próxima abertura (login incluso) já vir na cor da assessoria, sem piscar.
export function applyTheme(value: unknown): ThemeId {
  const theme = isThemeId(value) ? value : DEFAULT_THEME;
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* sem armazenamento: só não lembra */ }
  return theme;
}

// Antes do primeiro render: a última cor usada neste navegador.
export function initTheme(): void {
  let saved: string | null = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* ignora */ }
  document.documentElement.dataset.theme = isThemeId(saved) ? saved : DEFAULT_THEME;
}
