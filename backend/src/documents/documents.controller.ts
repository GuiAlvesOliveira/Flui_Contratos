import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { UpdateDocumentDto } from './dto/update-document.dto';
import { DocumentsService } from './documents.service';

@Controller()
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

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

  @Post('processes/:processId/documents/init-checklist')
  @Roles('dono', 'analista')
  initChecklist(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.initChecklist(processId, req.user);
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
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    if (contentLength !== undefined) {
      res.setHeader('Content-Length', contentLength);
    }
    return new StreamableFile(stream);
  }

  @Post('documents/:docId/upload')
  @Roles('dono', 'analista', 'cliente')
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
