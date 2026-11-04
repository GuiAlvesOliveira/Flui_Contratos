import { Module } from '@nestjs/common';
import { AzureStorageService } from '../common/services/azure-storage.service';
import { FichaModule } from '../ficha/ficha.module';
import { BankFormsController } from './bank-forms.controller';
import { BankFormsService } from './bank-forms.service';

// Formulários do banco (Itaú) preenchidos com a ficha e salvos no processo
@Module({
  imports: [FichaModule],
  controllers: [BankFormsController],
  providers: [BankFormsService, AzureStorageService],
})
export class BankFormsModule {}
