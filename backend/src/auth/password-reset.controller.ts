import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail } from 'class-validator';
import { Public } from '../common/decorators/public.decorator';
import { PasswordResetService } from './password-reset.service';

class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

export const FORGOT_PASSWORD_MESSAGE =
  'Se o e-mail estiver cadastrado, você vai receber um link para criar uma nova senha.';

@Controller('auth')
export class PasswordResetController {
  constructor(private readonly service: PasswordResetService) {}

  // BE-08: público (quem esqueceu a senha não tem token); 5 pedidos por minuto por IP
  @Post('forgot-password')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    void this.service.request(dto.email);
    return { message: FORGOT_PASSWORD_MESSAGE };
  }
}
