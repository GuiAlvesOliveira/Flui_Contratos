import {
  BadRequestException,
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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { BulkCreateUsersDto } from './dto/bulk-create-users.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
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
    @Body() body: BulkCreateUsersDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.usersService.createBulk(body.users, req.user);
  }

  // BE-01: importação em lote pelo arquivo CSV (campo "file", até 1 MB)
  @Post('import')
  @Roles('dono', 'analista')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 1024 * 1024 } }),
  )
  importCsv(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req: { user: RequestUserFull },
  ) {
    if (!file || !/\.(csv|txt)$/i.test(file.originalname)) {
      throw new BadRequestException('Envie um arquivo .csv no campo "file"');
    }
    return this.usersService.importCsv(file.buffer, req.user);
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

  // BE-18: senha temporária de quem ainda não fez o primeiro acesso
  @Get(':id/temporary-password')
  @Roles('dono', 'analista')
  getTemporaryPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.usersService.getTemporaryPassword(id, req.user);
  }

  @Post(':id/temporary-password')
  @Roles('dono', 'analista')
  regenerateTemporaryPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.usersService.regenerateTemporaryPassword(id, req.user);
  }

  @Patch(':id/profile')
  @Roles('admin', 'dono', 'analista', 'cliente')
  updateProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProfileDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.usersService.updateProfile(id, dto, req.user);
  }

  @Patch(':id/status')
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
