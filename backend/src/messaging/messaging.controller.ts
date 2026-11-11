import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Request,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  OUTBOX_STATUSES,
  OutboxAdminService,
  type EmailMode,
  type OutboxStatus,
} from './outbox-admin.service';
import { TENANT_MAX_DAILY_LIMIT } from './outbox.worker';

class UpdateSettingsDto {
  @IsOptional()
  @IsIn(['manual', 'auto'], {
    message: 'O modo de envio é "manual" (aprovação do gestor) ou "auto"',
  })
  mode?: EmailMode;

  @IsOptional()
  @IsInt({ message: 'O limite diário precisa ser um número inteiro' })
  @Min(1, { message: 'O limite diário precisa ser de pelo menos 1 e-mail' })
  @Max(TENANT_MAX_DAILY_LIMIT, {
    message: `O limite diário pode ser de no máximo ${TENANT_MAX_DAILY_LIMIT} e-mails`,
  })
  dailyLimit?: number;
}

class ListQueryDto {
  @IsOptional()
  @IsIn(OUTBOX_STATUSES)
  status?: OutboxStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

// Algumas mensagens (ids) ou todas as que estiverem naquela situação.
class SelectionDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids?: string[];

  @IsOptional()
  @IsBoolean()
  all?: boolean;
}

/**
 * E-mails da assessoria sob controle do gestor (tela "E-mails" do Log de
 * Ações): modo de envio, limite diário e o que fazer com cada mensagem.
 */
@Controller('messaging')
@Roles('dono')
export class MessagingController {
  constructor(private readonly outbox: OutboxAdminService) {}

  @Get('settings')
  settings(@Request() req: { user: RequestUserFull }) {
    return this.outbox.settings(req.user);
  }

  @Put('settings')
  updateSettings(
    @Body() dto: UpdateSettingsDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.outbox.updateSettings(dto, req.user);
  }

  @Get('outbox')
  list(@Query() q: ListQueryDto, @Request() req: { user: RequestUserFull }) {
    return this.outbox.list(req.user, q);
  }

  @Get('outbox/:id')
  content(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.outbox.content(id, req.user);
  }

  @Post('outbox/release')
  @HttpCode(200)
  release(
    @Body() dto: SelectionDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.outbox.release(dto, req.user);
  }

  @Post('outbox/cancel')
  @HttpCode(200)
  cancel(@Body() dto: SelectionDto, @Request() req: { user: RequestUserFull }) {
    return this.outbox.cancel(dto, req.user);
  }

  @Post('outbox/:id/resend')
  @HttpCode(200)
  resend(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.outbox.resend(id, req.user);
  }
}
