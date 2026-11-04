import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { BankFormsService } from './bank-forms.service';

type Req = { user: RequestUserFull };

// Só a equipe: os formulários gerados ficam ocultos do cliente
@Controller('processes/:processId/bank-forms')
export class BankFormsController {
  constructor(private readonly service: BankFormsService) {}

  @Get()
  @Roles('dono', 'analista')
  list(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Request() req: Req,
  ) {
    return this.service.list(processId, req.user);
  }

  @Post(':formKey')
  @Roles('dono', 'analista')
  generate(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Param('formKey') formKey: string,
    @Request() req: Req,
  ) {
    return this.service.generate(processId, formKey, req.user);
  }

  @Get('files/:fileId/download')
  @Roles('dono', 'analista')
  async download(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Request() req: Req,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, contentLength, fileName } = await this.service.download(
      processId,
      fileId,
      req.user,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    );
    if (contentLength !== undefined)
      res.setHeader('Content-Length', contentLength);
    return new StreamableFile(stream);
  }

  @Delete('files/:fileId')
  @Roles('dono', 'analista')
  remove(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Request() req: Req,
  ) {
    return this.service.remove(processId, fileId, req.user);
  }
}
