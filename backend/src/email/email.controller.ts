import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import { IsEmail } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { EmailService } from './email.service';

class TestEmailDto {
  @IsEmail()
  to: string;
}

@Controller('email')
export class EmailController {
  constructor(private readonly email: EmailService) {}

  @Post('test')
  @Roles('dono')
  @HttpCode(200)
  async test(@Body() dto: TestEmailDto) {
    try {
      await this.email.sendOrThrow(
        dto.to,
        'Flui Contratos — teste de e-mail',
        `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#18181b">
          <div style="background:#2563eb;padding:24px 28px;border-radius:8px 8px 0 0">
            <div style="color:#fff;font-size:20px;font-weight:700">Flui Contratos</div>
          </div>
          <div style="background:#fff;padding:28px;border:1px solid #e4e4e7;border-top:none;border-radius:0 0 8px 8px">
            <p>Se você recebeu este e-mail, a integração SMTP está funcionando corretamente.</p>
            <p style="font-size:13px;color:#71717a">Enviado via Brevo · ${new Date().toLocaleString('pt-BR')}</p>
          </div>
        </div>
        `,
      );
    } catch (err: unknown) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Falha no envio');
    }
    return { ok: true, to: dto.to };
  }
}
