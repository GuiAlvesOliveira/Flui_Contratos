import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Request,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { TrackUsage } from '../common/decorators/track-usage.decorator';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { DpsFormDto, FinanciamentoFormDto } from './dto/forms.dto';
import {
  RemoveDocumentQueryDto,
  RequestDocumentsDto,
} from './dto/request-documents.dto';
import { DocumentsService } from './documents.service';

@Controller()
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  // FE-23: DPS (equipe ou o próprio cliente) e financiamento (só a equipe)
  @Put('processes/:processId/forms/dps')
  @Roles('dono', 'analista', 'cliente')
  @TrackUsage('form_submitted', () => ({ form: 'dps' }))
  submitDps(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Body() dto: DpsFormDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.submitForm(processId, 'dps', dto, req.user);
  }

  @Put('processes/:processId/forms/financiamento')
  @Roles('dono', 'analista')
  @TrackUsage('form_submitted', () => ({ form: 'financiamento' }))
  submitFinanciamento(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Body() dto: FinanciamentoFormDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.submitForm(processId, 'financiamento', dto, req.user);
  }

  @Get('documents/stats')
  @Roles('dono', 'analista')
  getStats(@Request() req: { user: RequestUserFull }) {
    return this.service.getStats(req.user);
  }

  @Get('processes/:processId/documents')
  @Roles('dono', 'analista', 'cliente')
  getForProcess(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.getForProcess(processId, req.user);
  }

  // BE-03: request documents for a process, picked from the catalog
  @Post('processes/:processId/documents/request')
  @Roles('dono', 'analista')
  requestDocuments(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Body() dto: RequestDocumentsDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.requestDocuments(
      processId,
      dto.documentTypeIds,
      req.user,
    );
  }

  // BE-10 / LGPD: complete removal (file in storage + record)
  @Delete('documents/:docId')
  @Roles('dono', 'analista')
  remove(
    @Param('docId', ParseUUIDPipe) docId: string,
    @Query() query: RemoveDocumentQueryDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.removeDocument(docId, query, req.user);
  }

  @Patch('documents/:docId')
  @Roles('dono', 'analista', 'cliente')
  update(
    @Param('docId', ParseUUIDPipe) docId: string,
    @Body() dto: UpdateDocumentDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.update(docId, dto, req.user);
  }

  @Get('documents/:docId/download')
  @Roles('dono', 'analista', 'cliente')
  @Header('Cache-Control', 'no-store')
  async downloadFile(
    @Param('docId', ParseUUIDPipe) docId: string,
    @Request() req: { user: RequestUserFull },
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, contentType, contentLength, fileName } =
      await this.service.downloadFile(docId, req.user);
    // nosniff impede que um upload rotulado errado (ex.: HTML enviado como
    // image/png) seja "sniffed" e executado pelo browser; tipos que não sejam
    // imagem/pdf são forçados a download em vez de inline (SEC-06).
    const inlineSafe =
      !!contentType &&
      (contentType === 'application/pdf' || contentType.startsWith('image/'));
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `${inlineSafe ? 'inline' : 'attachment'}; filename="${encodeURIComponent(fileName)}"`,
    );
    if (contentLength !== undefined) {
      res.setHeader('Content-Length', contentLength);
    }
    return new StreamableFile(stream);
  }

  @Post('documents/:docId/upload')
  @Roles('dono', 'analista', 'cliente')
  @TrackUsage('document_uploaded')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    fileFilter: (_req, file, cb) => {
      const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
      cb(null, allowed.includes(file.mimetype));
    },
  }))
  upload(
    @Param('docId', ParseUUIDPipe) docId: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.uploadFile(docId, file, req.user);
  }
}
