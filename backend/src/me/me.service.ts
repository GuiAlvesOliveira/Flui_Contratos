import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import { SupabaseAdminService } from '../common/services/supabase-admin.service';
import { User } from '../users/user.entity';
import { OnboardingDto } from './dto/onboarding.dto';

@Injectable()
export class MeService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  async changePassword(user: RequestUserFull, newPassword: string): Promise<void> {
    await this.supabaseAdmin.updateUserPassword(user.externalId, newPassword);
    await this.userRepo.update(user.userId, { mustChangePassword: false });
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

    await this.userRepo.update(user.userId, update);
    return { onboardingCompleted: true };
  }
}
