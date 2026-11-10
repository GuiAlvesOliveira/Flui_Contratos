import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class UpdateDocumentDto {
  @IsOptional()
  @IsIn(['pendente', 'recebido', 'validado', 'rejeitado'])
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  validatedByNotes?: string;

  // Mês a que o documento se refere (competência do holerite, mês do extrato
  // ou da conta). Obrigatório para validar um tipo com prazo de validade; num
  // documento já validado, informa ou corrige o mês (documentos antigos).
  @IsOptional()
  @Matches(/^(\d{4}-(0[1-9]|1[0-2])|(0[1-9]|1[0-2])\/\d{4})$/, {
    message: 'mês de referência inválido — use MM/AAAA',
  })
  referenceMonth?: string;

  // Processo aberto na tela: o registro de auditoria de um documento pessoal
  // (que vale para todos os processos do cliente) vai para ele.
  @IsOptional()
  @IsUUID()
  processId?: string;
}
