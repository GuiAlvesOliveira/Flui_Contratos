import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../../tenants/tenant.entity';
import { User } from '../../users/user.entity';
import { TenantGuard } from './tenant.guard';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [TypeOrmModule.forFeature([User, Tenant])],
  providers: [TenantGuard, RolesGuard],
  exports: [TenantGuard, RolesGuard, TypeOrmModule],
})
export class GuardsModule {}
