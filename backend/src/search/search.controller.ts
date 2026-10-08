import { Controller, Get, Query, Request } from '@nestjs/common';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly service: SearchService) {}

  // FE-30: busca global da topbar (equipe da assessoria)
  @Get()
  @Roles('dono', 'analista')
  search(
    @Query() query: SearchQueryDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.search(query.q, req.user);
  }
}
