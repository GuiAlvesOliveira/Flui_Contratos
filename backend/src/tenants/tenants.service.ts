import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import {
  AzureStorageService,
  type BlobDownload,
} from '../common/services/azure-storage.service';
import { Tenant } from './tenant.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

export const LOGO_MAX_BYTES = 1024 * 1024;

// PROD-04: what the assessoria's team and clients read about it. The storage
// key of the logo stays on the server; the browser asks GET /tenants/me/logo.
export interface TenantView {
  id: string;
  name: string;
  slug: string;
  logo: { mimeType: string; updatedAt: Date } | null;
}

// The real bytes decide the type, never the declared Content-Type (as for
// documents, SEC-06): only PNG and JPEG are accepted for the logo.
export function logoType(
  buffer: Buffer | undefined,
): { mime: 'image/png' | 'image/jpeg'; ext: 'png' | 'jpg' } | null {
  if (!buffer || buffer.length < 8) return null;
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => buffer[i] === b)) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  return null;
}

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    private readonly azureStorage: AzureStorageService,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateTenantDto): Promise<Tenant> {
    const existing = await this.tenantRepo.findOne({
      where: { slug: dto.slug },
    });
    if (existing) throw new ConflictException('Slug já existe');

    const tenant = this.tenantRepo.create(dto);
    return this.tenantRepo.save(tenant);
  }

  // RN-01: always the caller's own assessoria — there is no tenant id to pick.
  async getMine(caller: RequestUserFull): Promise<TenantView> {
    return view(await this.mine(caller));
  }

  async updateMine(
    dto: UpdateTenantDto,
    caller: RequestUserFull,
  ): Promise<TenantView> {
    const tenant = await this.mine(caller);
    if (dto.name === tenant.name) return view(tenant);

    const before = tenant.name;
    await this.dataSource.transaction(async (manager) => {
      await manager.update(Tenant, tenant.id, { name: dto.name });
      await audit(
        manager,
        caller,
        'tenant_updated',
        { field: 'name', before, after: dto.name },
        [before, dto.name],
      );
    });
    return view({ ...tenant, name: dto.name });
  }

  // The new file gets a new key, so a browser never shows the old image from
  // its cache; the previous file is removed after the row points to the new one.
  async uploadLogo(
    file: Express.Multer.File | undefined,
    caller: RequestUserFull,
  ): Promise<TenantView> {
    if (!file) throw new BadRequestException('Envie a imagem do logo');
    if (file.size > LOGO_MAX_BYTES) {
      throw new BadRequestException('O logo pode ter no máximo 1 MB');
    }
    const type = logoType(file.buffer);
    if (!type) {
      throw new BadRequestException('O logo precisa ser uma imagem PNG ou JPG');
    }
    if (!this.azureStorage.isAvailable) {
      throw new ServiceUnavailableException(
        'Armazenamento indisponível — o logo não foi salvo. Tente novamente.',
      );
    }
    const tenant = await this.mine(caller);
    const key = `${tenant.id}/branding/logo-${Date.now()}.${type.ext}`;
    await this.azureStorage.upload(key, file.buffer, type.mime);

    const updatedAt = new Date();
    await this.dataSource.transaction(async (manager) => {
      await manager.update(Tenant, tenant.id, {
        logoPath: key,
        logoMime: type.mime,
        logoUpdatedAt: updatedAt,
      });
      await audit(manager, caller, 'tenant_logo_updated', {
        mimeType: type.mime,
        sizeBytes: file.size,
      });
    });
    if (tenant.logoPath && tenant.logoPath !== key) {
      await this.dropBlob(tenant.logoPath);
    }
    return view({
      ...tenant,
      logoPath: key,
      logoMime: type.mime,
      logoUpdatedAt: updatedAt,
    });
  }

  async removeLogo(caller: RequestUserFull): Promise<TenantView> {
    const tenant = await this.mine(caller);
    if (!tenant.logoPath) return view(tenant);
    if (!this.azureStorage.isAvailable) {
      throw new ServiceUnavailableException(
        'Armazenamento indisponível — o logo não foi removido. Tente novamente.',
      );
    }
    await this.azureStorage.delete(tenant.logoPath);
    await this.dataSource.transaction(async (manager) => {
      await manager.update(Tenant, tenant.id, {
        logoPath: null,
        logoMime: null,
        logoUpdatedAt: new Date(),
      });
      await audit(manager, caller, 'tenant_logo_removed', {});
    });
    return view({ ...tenant, logoPath: null, logoMime: null });
  }

  async getLogo(caller: RequestUserFull): Promise<BlobDownload> {
    const tenant = await this.mine(caller);
    if (!tenant.logoPath) throw new NotFoundException('Assessoria sem logo');
    if (!this.azureStorage.isAvailable) {
      throw new ServiceUnavailableException('Armazenamento indisponível');
    }
    const blob = await this.azureStorage.download(tenant.logoPath);
    return { ...blob, contentType: tenant.logoMime ?? blob.contentType };
  }

  private async mine(caller: RequestUserFull): Promise<Tenant> {
    const tenant = caller.tenantId
      ? await this.tenantRepo.findOne({ where: { id: caller.tenantId } })
      : null;
    if (!tenant) throw new NotFoundException('Assessoria não encontrada');
    return tenant;
  }

  private async dropBlob(key: string): Promise<void> {
    try {
      await this.azureStorage.delete(key);
    } catch (err) {
      // The row already points to the new logo; an orphan file is harmless.
      this.logger.warn(
        `Logo anterior não removido (${key}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

function view(t: Tenant): TenantView {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    logo:
      t.logoPath && t.logoMime && t.logoUpdatedAt
        ? { mimeType: t.logoMime, updatedAt: t.logoUpdatedAt }
        : null,
  };
}

// RN-07: changes to the assessoria go to the tenant's Log de Ações; a rename
// also fills "De → Para" (names are at most 100 characters, like the column).
function audit(
  manager: { query: (sql: string, params: unknown[]) => Promise<unknown> },
  caller: RequestUserFull,
  action: string,
  metadata: Record<string, unknown>,
  [from, to]: [string | null, string | null] = [null, null],
) {
  return manager.query(
    `INSERT INTO audit_logs (tenant_id, actor_id, action, from_state, to_state, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      caller.tenantId,
      caller.userId,
      action,
      from,
      to,
      JSON.stringify(metadata),
    ],
  );
}
