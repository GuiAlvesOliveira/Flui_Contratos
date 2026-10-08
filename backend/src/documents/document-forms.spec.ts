import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import { Process } from '../processes/process.entity';
import { User } from '../users/user.entity';
import { formsAvailable } from './document-forms';
import { Document } from './document.entity';
import { DocumentType } from './document-type.entity';
import { DocumentsService } from './documents.service';
import { DpsFormDto, FinanciamentoFormDto } from './dto/forms.dto';

const caller = (role: string, userId = 'u1') =>
  ({ role, tenantId: 't1', userId }) as RequestUserFull;

function makeService() {
  const repo = {
    findOne: jest.fn(),
    create: jest.fn((x: object) => ({ ...x })),
    save: jest.fn((x: object) => Promise.resolve({ id: 'd1', ...x })),
  };
  const processRepo = { findOne: jest.fn() };
  const dataSource = { query: jest.fn() };
  const service = new DocumentsService(
    repo as unknown as Repository<Document>,
    {} as Repository<DocumentType>,
    processRepo as unknown as Repository<Process>,
    {} as Repository<User>,
    {} as never,
    dataSource as unknown as DataSource,
    {} as never,
    { fireEvent: jest.fn() } as never,
  );
  return { service, repo, processRepo, dataSource };
}

const dps = {
  alturaCm: 170,
  pesoKg: 72.5,
  tratamento: false,
  doencaGrave: false,
  internacao: false,
  deficiencia: false,
  afastamento: false,
  declaracao: true,
};
const financiamento = {
  banco: 'Caixa Econômica Federal',
  sistemaAmortizacao: 'SAC',
  prazoMeses: 360,
  valorFinanciado: 280000,
  valorEntrada: 70000,
  usaFgts: true,
  valorFgts: 15000,
  taxaJurosAnual: 10.5,
};
const errors = async (cls: new () => object, data: object) =>
  (await validate(plainToInstance(cls, data))).map((e) => e.property);

describe('FE-23: DPS and financing forms', () => {
  it('open from Análise de Crédito on', () => {
    expect(formsAvailable('cadastro', null)).toBe(false);
    expect(formsAvailable('inicial', null)).toBe(false);
    expect(formsAvailable('cliente_inativo', null)).toBe(false);
    expect(formsAvailable('analise_credito', null)).toBe(true);
    expect(formsAvailable('cartorio', null)).toBe(true);
    expect(formsAvailable('credito_recusado', null)).toBe(true);
    expect(formsAvailable('processo_pendencia', 'cadastro')).toBe(false);
    expect(formsAvailable('processo_pendencia', 'analise_juridica')).toBe(true);
    expect(formsAvailable('processo_pendencia', null)).toBe(false);
  });

  it('validates the DPS: ranges, a "yes" needs details, declaration required', async () => {
    expect(await errors(DpsFormDto, dps)).toEqual([]);
    expect(await errors(DpsFormDto, { ...dps, alturaCm: 90 })).toEqual([
      'alturaCm',
    ]);
    expect(await errors(DpsFormDto, { ...dps, tratamento: true })).toEqual([
      'detalhes',
    ]);
    expect(
      await errors(DpsFormDto, {
        ...dps,
        tratamento: true,
        detalhes: 'Hipertensão controlada',
      }),
    ).toEqual([]);
    expect(await errors(DpsFormDto, { ...dps, declaracao: false })).toEqual([
      'declaracao',
    ]);
    // missing details: one clear message, not one per rule
    const [missing] = await validate(
      plainToInstance(DpsFormDto, { ...dps, tratamento: true }),
    );
    expect(Object.values(missing.constraints ?? {})).toEqual([
      'descreva os itens marcados como "sim" (até 1000 caracteres)',
    ]);
    expect(
      await errors(DpsFormDto, {
        ...dps,
        tratamento: true,
        detalhes: 'x'.repeat(1001),
      }),
    ).toEqual(['detalhes']);
  });

  it('validates the financing form', async () => {
    expect(await errors(FinanciamentoFormDto, financiamento)).toEqual([]);
    expect(
      await errors(FinanciamentoFormDto, {
        ...financiamento,
        sistemaAmortizacao: 'SACRE',
      }),
    ).toEqual(['sistemaAmortizacao']);
    expect(
      await errors(FinanciamentoFormDto, {
        ...financiamento,
        valorFgts: undefined,
      }),
    ).toEqual(['valorFgts']);
    expect(
      await errors(FinanciamentoFormDto, {
        ...financiamento,
        usaFgts: false,
        valorFgts: undefined,
      }),
    ).toEqual([]);
    expect(
      await errors(FinanciamentoFormDto, { ...financiamento, prazoMeses: 500 }),
    ).toEqual(['prazoMeses']);
  });

  it('saves the form as a "recebido" document of the checklist and logs it', async () => {
    const { service, repo, processRepo, dataSource } = makeService();
    processRepo.findOne.mockResolvedValue({
      id: 'p1',
      clientId: 'c1',
      stage: 'analise_credito',
      stageBeforePendencia: null,
    });
    repo.findOne.mockResolvedValue(null);
    const saved = await service.submitForm(
      'p1',
      'dps',
      dps,
      caller('cliente', 'c1'),
    );
    // the cliente only reaches their own process
    expect(processRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'p1', tenantId: 't1', clientId: 'c1' },
    });
    expect(saved).toMatchObject({
      tenantId: 't1',
      processId: 'p1',
      userId: 'c1',
      label: 'DPS — Declaração Pessoal de Saúde',
      formType: 'dps',
      formData: dps,
      status: 'recebido',
      validated: false,
      uploadedBy: 'c1',
    });
    const [sql, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("'form_submitted'");
    // the answers (health data) stay out of the audit log
    expect(params).toEqual([
      't1',
      'p1',
      'c1',
      JSON.stringify({
        docId: 'd1',
        label: 'DPS — Declaração Pessoal de Saúde',
      }),
    ]);
  });

  it('a new submission replaces a rejected form; a validated one is kept', async () => {
    const { service, repo, processRepo } = makeService();
    processRepo.findOne.mockResolvedValue({
      id: 'p1',
      clientId: 'c1',
      stage: 'analise_juridica',
      stageBeforePendencia: null,
    });
    repo.findOne.mockResolvedValueOnce({
      id: 'd9',
      formType: 'financiamento',
      status: 'rejeitado',
      validatedByNotes: 'Prazo errado',
      formData: { prazoMeses: 12 },
    });
    const saved = await service.submitForm(
      'p1',
      'financiamento',
      financiamento,
      caller('analista'),
    );
    expect(saved).toMatchObject({
      id: 'd9',
      status: 'recebido',
      validatedByNotes: null,
    });
    expect(saved.formData).toEqual(financiamento);

    repo.findOne.mockResolvedValueOnce({ id: 'd9', status: 'validado' });
    await expect(
      service.submitForm(
        'p1',
        'financiamento',
        financiamento,
        caller('analista'),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('refuses before Análise de Crédito and outside the tenant', async () => {
    const { service, repo, processRepo } = makeService();
    processRepo.findOne.mockResolvedValueOnce({
      id: 'p1',
      clientId: 'c1',
      stage: 'cadastro',
      stageBeforePendencia: null,
    });
    await expect(
      service.submitForm('p1', 'dps', dps, caller('analista')),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    processRepo.findOne.mockResolvedValueOnce(null);
    await expect(
      service.submitForm('p1', 'dps', dps, caller('cliente', 'outro')),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.save).not.toHaveBeenCalled();
  });
});
