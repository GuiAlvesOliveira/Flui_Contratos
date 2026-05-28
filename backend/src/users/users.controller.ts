import {
  Body,
  Controller,
  Delete,
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
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles('admin', 'dono', 'analista')
  create(
    @Body() dto: CreateUserDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.usersService.create(dto, req.user);
  }

  @Post('bulk')
  @Roles('admin', 'dono', 'analista')
  createBulk(
    @Body() body: { users: CreateUserDto[] },
    @Request() req: { user: RequestUserFull },
  ) {
    return this.usersService.createBulk(body.users, req.user);
  }

  @Get()
  @Roles('admin', 'dono', 'analista')
  findAll(
    @Request() req: { user: RequestUserFull },
    @Query('tenantId') tenantId?: string,
    @Query('role') role?: string,
  ) {
    return this.usersService.findAll(req.user, tenantId, role);
  }

  @Get(':id')
  @Roles('admin', 'dono', 'analista')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.usersService.findOne(id, req.user);
  }

  @Patch(':id/profile')
  @Roles('admin', 'dono', 'analista', 'cliente')
  updateProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Partial<{ name: string; surname: string; cpf: string; telefone: string }>,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.usersService.updateProfile(id, dto, req.user);
  }

  @Patch(':id/activate')
  @Roles('admin', 'dono')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.usersService.updateStatus(id, dto, req.user);
  }

  @Post(':id/resend-invite')
  @Roles('admin', 'dono', 'analista')
  resendInvite(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.usersService.resendInvite(id, req.user);
  }

  @Delete(':id')
  @Roles('dono')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.usersService.remove(id, req.user);
  }
}
