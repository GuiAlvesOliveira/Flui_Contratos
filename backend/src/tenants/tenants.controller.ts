import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Patch,
  Post,
  Put,
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
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { LOGO_MAX_BYTES, TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  @Roles('admin')
  create(@Body() dto: CreateTenantDto) {
    return this.tenantsService.create(dto);
  }

  // PROD-04: a própria assessoria. Todos leem; só o gestor altera.
  @Get('me')
  @Roles('dono', 'analista', 'cliente')
  getMine(@Request() req: { user: RequestUserFull }) {
    return this.tenantsService.getMine(req.user);
  }

  @Patch('me')
  @Roles('dono')
  updateMine(
    @Body() dto: UpdateTenantDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.tenantsService.updateMine(dto, req.user);
  }

  // Logo: PNG ou JPG até 1 MB, no container privado (o serviço confere os bytes)
  @Put('me/logo')
  @Roles('dono')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES } }),
  )
  uploadLogo(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.tenantsService.uploadLogo(file, req.user);
  }

  @Delete('me/logo')
  @Roles('dono')
  removeLogo(@Request() req: { user: RequestUserFull }) {
    return this.tenantsService.removeLogo(req.user);
  }

  @Get('me/logo')
  @Roles('dono', 'analista', 'cliente')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, max-age=300')
  async getLogo(
    @Request() req: { user: RequestUserFull },
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, contentType, contentLength } =
      await this.tenantsService.getLogo(req.user);
    res.setHeader('Content-Type', contentType);
    if (contentLength !== undefined) {
      res.setHeader('Content-Length', contentLength);
    }
    return new StreamableFile(stream);
  }
}
