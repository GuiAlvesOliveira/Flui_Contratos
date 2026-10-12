import { Body, Controller, Get, Patch, Request } from '@nestjs/common';
import { RequestUserFull } from '../auth/supabase.guard';
import { OnboardingExempt } from '../common/decorators/onboarding-exempt.decorator';
import { PasswordChangeExempt } from '../common/decorators/password-change-exempt.decorator';
import { TrackUsage } from '../common/decorators/track-usage.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { OnboardingDto } from './dto/onboarding.dto';
import { MeService } from './me.service';

@Controller('me')
export class MeController {
  constructor(private readonly meService: MeService) {}

  // VAL-04: o app chama /me ao entrar (login ou sessão retomada)
  @Get()
  @PasswordChangeExempt()
  @OnboardingExempt()
  @TrackUsage('login')
  getMe(@Request() req: { user: RequestUserFull }) {
    const user = req.user;
    return {
      id: user.userId,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      onboardingCompleted: user.onboardingCompleted,
      mustChangePassword: user.mustChangePassword,
    };
  }

  @Patch('change-password')
  @PasswordChangeExempt()
  @OnboardingExempt()
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Request() req: { user: RequestUserFull },
  ) {
    await this.meService.changePassword(req.user, dto.newPassword);
    return { message: 'Senha atualizada' };
  }

  @Patch('onboarding')
  @OnboardingExempt()
  completeOnboarding(
    @Body() dto: OnboardingDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.meService.completeOnboarding(req.user, dto);
  }
}
