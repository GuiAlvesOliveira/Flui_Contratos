import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import { UserContextCache } from '../auth/user-context.cache';
import { SupabaseAdminService } from '../common/services/supabase-admin.service';
import { TemporaryPasswordStore } from '../common/services/temporary-password.store';
import { User } from '../users/user.entity';
import { OnboardingDto } from './dto/onboarding.dto';

@Injectable()
export class MeService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly userCache: UserContextCache,
    private readonly tempPasswords: TemporaryPasswordStore,
    private readonly dataSource: DataSource,
  ) {}

  async changePassword(user: RequestUserFull, newPassword: string): Promise<void> {
    await this.supabaseAdmin.updateUserPassword(user.externalId, newPassword);
    await this.userRepo.update(user.userId, { mustChangePassword: false });
    // BE-18: the temporary password stops working now; nobody can see it again
    await this.tempPasswords.remove(user.userId);
    this.userCache.invalidateUser(user.userId);
  }

  async completeOnboarding(user: RequestUserFull, dto: OnboardingDto) {
    const update: Partial<User> = {
      name: dto.name,
      onboardingCompleted: true,
    };
    if (dto.surname !== undefined) update.surname = dto.surname;
    if (dto.telefone !== undefined) update.telefone = dto.telefone;
    if (dto.cpf !== undefined) update.cpf = dto.cpf;
    if (dto.rg !== undefined) update.rg = dto.rg;
    if (dto.dataNascimento !== undefined) {
      update.dataNascimento = dto.dataNascimento;
    }
    if (dto.cep !== undefined) update.cep = dto.cep.replace(/\D/g, '');
    if (dto.endereco !== undefined) update.endereco = dto.endereco.trim() || null;

    // Estado civil e fonte de renda são do cliente: ficam guardados nele e
    // preenchem os processos dele que ainda não têm esses dados — o que a
    // equipe já informou no processo não é trocado. Antes de concluir o
    // onboarding, para uma falha aqui não deixar a ficha pela metade.
    if (user.role === 'cliente') {
      if (dto.estadoCivil !== undefined) update.estadoCivil = dto.estadoCivil;
      if (dto.fonteRenda !== undefined) update.fonteRenda = dto.fonteRenda;
      if (dto.estadoCivil !== undefined || dto.fonteRenda !== undefined) {
        await this.fillProcesses(user, dto.estadoCivil ?? null, dto.fonteRenda ?? null);
      }
    }

    await this.userRepo.update(user.userId, update);
    // GET /me must report onboardingCompleted right away, or a reload sends the
    // user back to the onboarding screen (AUTH-09).
    this.userCache.invalidateUser(user.userId);
    return { onboardingCompleted: true };
  }

  private async fillProcesses(
    user: RequestUserFull,
    estadoCivil: string | null,
    fonteRenda: string | null,
  ) {
    await this.dataSource.transaction(async (manager) => {
      // SELECT over the UPDATE: the driver returns just the rows (a bare
      // UPDATE ... RETURNING comes back as [rows, count])
      const filled = await manager.query<{ id: string; fields: string }[]>(
        `WITH old AS (
           SELECT id, estado_civil, fonte_renda FROM processes
            WHERE client_id = $3 AND tenant_id = $4 AND active = true
              AND (($1::varchar IS NOT NULL AND estado_civil IS NULL)
                OR ($2::varchar IS NOT NULL AND fonte_renda IS NULL))
            FOR UPDATE),
         filled AS (
           UPDATE processes p
              SET estado_civil = COALESCE(p.estado_civil, $1),
                  fonte_renda = COALESCE(p.fonte_renda, $2),
                  updated_at = now()
             FROM old
            WHERE p.id = old.id
           RETURNING p.id, concat_ws(', ',
             CASE WHEN old.estado_civil IS NULL AND $1::varchar IS NOT NULL THEN 'estadoCivil' END,
             CASE WHEN old.fonte_renda IS NULL AND $2::varchar IS NOT NULL THEN 'fonteRenda' END) AS fields)
         SELECT id, fields FROM filled`,
        [estadoCivil, fonteRenda, user.userId, user.tenantId],
      );
      // RN-07: the change shows up in the process timeline, like any edit
      for (const p of filled) {
        await manager.query(
          `INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, metadata)
           VALUES ($1, $2, $3, 'profile_update', $4::jsonb)`,
          [user.tenantId, p.id, user.userId, JSON.stringify({ fields: p.fields })],
        );
      }
    });
  }
}
