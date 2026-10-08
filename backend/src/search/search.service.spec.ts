import { DataSource } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import { codePrefix, likePattern, SearchService } from './search.service';

const dono = { tenantId: 't1', userId: 'g1', role: 'dono' } as RequestUserFull;
const analista = {
  tenantId: 't1',
  userId: 'a1',
  role: 'analista',
} as RequestUserFull;

function make() {
  const dataSource = { query: jest.fn().mockResolvedValue([]) };
  const service = new SearchService(dataSource as unknown as DataSource);
  return { service, dataSource };
}

describe('FE-30: global search', () => {
  it('escapes LIKE wildcards and reads process codes', () => {
    expect(likePattern('Ana')).toBe('%Ana%');
    expect(likePattern('50%_x\\')).toBe('%50\\%\\_x\\\\%');
    expect(codePrefix('CLI-0392')).toBe('0392%');
    expect(codePrefix('cli0392')).toBe('0392%');
    expect(codePrefix('e00')).toBe('e00%');
    expect(codePrefix('Helena')).toBeNull();
  });

  it('needs at least 3 characters (after trimming)', async () => {
    const { service, dataSource } = make();
    expect(await service.search('  ab  ', dono)).toEqual({
      empreendimentos: [],
      proponentes: [],
      processos: [],
    });
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('searches inside the tenant; the gestor sees every process', async () => {
    const { service, dataSource } = make();
    dataSource.query
      .mockResolvedValueOnce([
        { id: 'e1', nome: 'Residencial Aurora', endereco: 'Rua A' },
      ])
      .mockResolvedValueOnce([
        {
          id: 'c1',
          name: 'Helena',
          surname: 'Narduci',
          email: 'h@x.dev',
          process_id: 'p1',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: '0392f00d-0000-4000-8000-000000000001',
          stage: 'cadastro',
          name: 'Helena',
          surname: null,
          email: 'h@x.dev',
          unidade: 'AP 102',
          empreendimento: 'Residencial Aurora',
        },
      ]);
    const res = await service.search(' Helena ', dono);
    const calls = dataSource.query.mock.calls as [string, unknown[]][];
    expect(calls[0][0]).toContain('tenant_id = $1 AND active = true');
    expect(calls[0][1]).toEqual(['t1', '%Helena%']);
    expect(calls[1][1]).toEqual(['t1', '%Helena%', null, null]);
    expect(calls[2][1]).toEqual(['t1', '%Helena%', null, null]);
    expect(res).toEqual({
      empreendimentos: [
        { id: 'e1', title: 'Residencial Aurora', sub: 'Rua A' },
      ],
      proponentes: [
        { id: 'c1', processId: 'p1', title: 'Helena Narduci', sub: 'h@x.dev' },
      ],
      processos: [
        {
          id: '0392f00d-0000-4000-8000-000000000001',
          title: 'CLI-0392 · Helena',
          sub: 'Cadastro · Residencial Aurora AP 102',
        },
      ],
    });
  });

  it('analista: only their processes and clients; CPF digits and codes', async () => {
    const { service, dataSource } = make();
    await service.search('529.982', analista);
    const calls = dataSource.query.mock.calls as [string, unknown[]][];
    expect(calls[1][1]).toEqual(['t1', '%529.982%', '%529982%', 'a1']);
    expect(calls[1][0]).toContain('p.analista_id = $4');
    expect(calls[2][1]).toEqual(['t1', '%529.982%', null, 'a1']);

    dataSource.query.mockClear();
    await service.search('CLI-0392', analista);
    const byCode = dataSource.query.mock.calls as [string, unknown[]][];
    expect(byCode[2][1]).toEqual(['t1', '%CLI-0392%', '0392%', 'a1']);
    expect(byCode[2][0]).toContain("replace(p.id::text, '-', '') LIKE $3");
  });
});
