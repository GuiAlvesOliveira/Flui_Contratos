import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Request,
} from '@nestjs/common';
import { IsEmail } from 'class-validator';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { DirectSendContext, EmailService } from './email.service';
import { smtpFailureReason } from './smtp-failure';

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
  async test(
    @Body() dto: TestEmailDto,
    @Request() req: { user: RequestUserFull },
  ) {
    const subject = 'Flui Contratos — teste de e-mail';
    // o teste conta no limite diário e fica na tela de E-mails, como os demais
    const ctx: DirectSendContext = {
      tenantId: req.user.tenantId ?? null,
      recipientRole: 'gestor',
      actorId: req.user.userId ?? null,
    };
    const report = (error: string | null) =>
      this.email.reportDirect({
        ...ctx,
        eventType: 'test_email',
        to: dto.to,
        subject,
        ok: error === null,
        error,
      });
    const refusal = await this.email.directRefusal(ctx);
    if (refusal) {
      report(refusal);
      throw new BadRequestException(refusal);
    }
    try {
      await this.email.sendOrThrow(
        dto.to,
        subject,
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
      // o motivo em português, do jeito que o gestor consegue agir (senha,
      // rede, remetente ou bloqueio de IP do provedor)
      const reason = smtpFailureReason(err);
      report(reason);
      throw new BadRequestException(reason);
    }
    report(null);
    return { ok: true, to: dto.to, from: this.email.sender };
  }
}
