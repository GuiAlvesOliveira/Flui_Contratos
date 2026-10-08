import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreateDocumentTypeDto,
  UpdateDocumentTypeDto,
} from './dto/document-type.dto';
import { DocumentTypesService } from './document-types.service';

@Controller('document-types')
export class DocumentTypesController {
  constructor(private readonly service: DocumentTypesService) {}

  // Analista reads the catalog to request documents; ?includeInactive=true
  // only takes effect for the gestor (catalog management screen).
  @Get()
  @Roles('dono', 'analista')
  list(
    @Request() req: { user: RequestUserFull },
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.service.list(req.user, includeInactive === 'true');
  }

  @Post()
  @Roles('dono')
  create(
    @Body() dto: CreateDocumentTypeDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.create(dto, req.user);
  }

  @Patch(':id')
  @Roles('dono')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentTypeDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.update(id, dto, req.user);
  }
}
