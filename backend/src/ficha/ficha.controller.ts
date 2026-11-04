import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
} from '@nestjs/common';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  AnswerDataRequestDto,
  CreateDataRequestDto,
  PatchFichaDto,
} from './dto/ficha.dto';
import { FichaService } from './ficha.service';

type Req = { user: RequestUserFull };

@Controller()
export class FichaController {
  constructor(private readonly service: FichaService) {}

  @Get('ficha/fields')
  @Roles('dono', 'analista', 'cliente')
  fields() {
    return this.service.fields();
  }

  @Get('processes/:processId/ficha')
  @Roles('dono', 'analista')
  get(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Request() req: Req,
  ) {
    return this.service.getFicha(processId, req.user);
  }

  @Patch('processes/:processId/ficha')
  @Roles('dono', 'analista')
  patch(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Body() dto: PatchFichaDto,
    @Request() req: Req,
  ) {
    return this.service.patchFicha(processId, dto, req.user);
  }

  @Get('processes/:processId/data-requests')
  @Roles('dono', 'analista', 'cliente')
  listRequests(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Request() req: Req,
  ) {
    return this.service.listRequests(processId, req.user);
  }

  @Post('processes/:processId/data-requests')
  @Roles('dono', 'analista')
  createRequest(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Body() dto: CreateDataRequestDto,
    @Request() req: Req,
  ) {
    return this.service.createRequest(processId, dto, req.user);
  }

  @Post('processes/:processId/data-requests/:requestId/answer')
  @Roles('cliente')
  answer(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: AnswerDataRequestDto,
    @Request() req: Req,
  ) {
    return this.service.answerRequest(
      processId,
      requestId,
      dto.values,
      req.user,
    );
  }

  @Delete('processes/:processId/data-requests/:requestId')
  @Roles('dono', 'analista')
  cancel(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Request() req: Req,
  ) {
    return this.service.cancelRequest(processId, requestId, req.user);
  }
}
