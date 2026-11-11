import { IsIn } from 'class-validator';
import { TENANT_THEMES, type TenantTheme } from '../tenant-theme';

/**
 * PUT /tenants/me/theme. The gestor picks one of the colours of the palette;
 * anything outside the list (a free hex, another field) is rejected.
 */
export class UpdateTenantThemeDto {
  @IsIn(TENANT_THEMES, { message: 'Escolha uma das cores da paleta' })
  themeColor: TenantTheme;
}
