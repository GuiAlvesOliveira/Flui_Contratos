import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import {
  DEFAULT_DOCUMENT_TYPES,
  DOCUMENT_CATEGORIES,
  DocumentType,
} from './document-type.entity';
import {
  CreateDocumentTypeDto,
  UpdateDocumentTypeDto,
} from './dto/document-type.dto';

// Postgres unique_violation (uq_document_types_tenant_label)
const UNIQUE_VIOLATION = '23505';

/**
 * BE-03: the assessoria's document catalog ("Configurações → Lista de
 * Documentos"). Tenant-scoped; only the gestor (dono) changes it.
 */
@Injectable()
export class DocumentTypesService {
  constructor(
    @InjectRepository(DocumentType)
    private readonly repo: Repository<DocumentType>,
  ) {}

  // A tenant created after the migration (e.g. by the dev seed or the admin
  // API) starts with the default catalog the first time it is read. Only when
  // the tenant has no entry at all: deactivating every entry is respected.
  async ensureDefaults(tenantId: string): Promise<void> {
    if ((await this.repo.count({ where: { tenantId } })) > 0) return;
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(DocumentType)
      .values(DEFAULT_DOCUMENT_TYPES.map((d) => ({ ...d, tenantId })))
      .orIgnore()
      .execute();
  }

  async list(caller: RequestUserFull, includeInactive = false) {
    await this.ensureDefaults(caller.tenantId!);
    const rows = await this.repo.find({
      where: {
        tenantId: caller.tenantId!,
        // Inactive entries are only listed for the gestor managing the catalog
        ...(includeInactive && caller.role === 'dono' ? {} : { active: true }),
      },
    });
    const order = (c: string) => DOCUMENT_CATEGORIES.indexOf(c as never);
    return rows.sort(
      (a, b) =>
        order(a.category) - order(b.category) ||
        a.label.localeCompare(b.label, 'pt-BR', { numeric: true }),
    );
  }

  async create(dto: CreateDocumentTypeDto, caller: RequestUserFull) {
    await this.ensureDefaults(caller.tenantId!);
    const entity = this.repo.create({
      tenantId: caller.tenantId!,
      label: dto.label,
      category: dto.category,
      description: dto.description || null,
    });
    return this.saveUnique(entity);
  }

  async update(
    id: string,
    dto: UpdateDocumentTypeDto,
    caller: RequestUserFull,
  ) {
    const entity = await this.repo.findOne({
      where: { id, tenantId: caller.tenantId! },
    });
    if (!entity)
      throw new NotFoundException('Documento não encontrado na lista');
    if (dto.label !== undefined) entity.label = dto.label;
    if (dto.category !== undefined) entity.category = dto.category;
    if (dto.description !== undefined)
      entity.description = dto.description || null;
    if (dto.active !== undefined) entity.active = dto.active;
    return this.saveUnique(entity);
  }

  private async saveUnique(entity: DocumentType) {
    try {
      return await this.repo.save(entity);
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictException(
          `Já existe um documento chamado "${entity.label}" na lista`,
        );
      }
      throw err;
    }
  }
}
