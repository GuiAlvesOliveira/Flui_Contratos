import { BadRequestException } from '@nestjs/common';
import { decodeCsv, MAX_IMPORT_ROWS, parseUsersCsv } from './users-csv';

describe('parseUsersCsv (BE-01)', () => {
  it('reads the Excel pt-BR format: BOM, ";", CRLF and "E-mail" header', () => {
    const csv =
      String.fromCharCode(0xfeff) +
      'Nome;Sobrenome;E-mail;CPF;Perfil\r\n' +
      'Ana;Souza;Ana@Exemplo.dev;529.982.247-25;Analista\r\n' +
      'Bruno;;bruno@exemplo.dev;11144477735;cliente\r\n';
    expect(parseUsersCsv(csv)).toEqual([
      {
        line: 2,
        name: 'Ana',
        email: 'ana@exemplo.dev',
        role: 'analista',
        dto: {
          name: 'Ana',
          email: 'ana@exemplo.dev',
          role: 'analista',
          surname: 'Souza',
          cpf: '52998224725',
        },
      },
      {
        line: 3,
        name: 'Bruno',
        email: 'bruno@exemplo.dev',
        role: 'cliente',
        dto: {
          name: 'Bruno',
          email: 'bruno@exemplo.dev',
          role: 'cliente',
          surname: undefined,
          cpf: '11144477735',
        },
      },
    ]);
  });

  it('reads "," files with quoted fields and columns in any order', () => {
    const csv =
      'perfil,email,nome,cpf\n' +
      'cliente,carla@exemplo.dev,"Carla ""Cacá"", da Silva",52998224725\n';
    const [row] = parseUsersCsv(csv);
    expect(row.dto).toMatchObject({
      name: 'Carla "Cacá", da Silva',
      email: 'carla@exemplo.dev',
      role: 'cliente',
    });
  });

  it('reports each bad line on its own and keeps the good ones', () => {
    const csv = [
      'nome;email;cpf;perfil',
      ';sem.nome@exemplo.dev;52998224725;cliente',
      'Davi;nao-e-email;52998224725;cliente',
      'Eva;eva@exemplo.dev;52998224725;admin',
      'Fabio;fabio@exemplo.dev;;analista',
      'Gil;gil@exemplo.dev;123;cliente',
      '',
      'Hugo;hugo@exemplo.dev;52998224725;cliente',
      'Hugo 2;HUGO@exemplo.dev;52998224725;cliente',
      'Iris;iris@exemplo.dev;;gestor',
    ].join('\n');
    const rows = parseUsersCsv(csv);
    expect(rows.map((r) => [r.line, r.error ?? 'ok'])).toEqual([
      [2, 'Nome em branco'],
      [3, 'E-mail inválido'],
      [4, 'Perfil inválido: use analista ou cliente'],
      [5, 'CPF obrigatório'],
      [6, 'CPF deve ter 11 dígitos'],
      [8, 'ok'],
      [9, 'E-mail repetido no arquivo (linha 8)'],
      [10, 'ok'],
    ]);
    expect(rows[7].dto?.role).toBe('dono'); // "gestor" is the dono role
  });

  it.each([
    ['', 'O arquivo está vazio'],
    [
      'nome;perfil\nAna;cliente',
      'O cabeçalho precisa das colunas nome, email e perfil (sobrenome e cpf são opcionais)',
    ],
    ['nome;email;perfil\n;;\n', 'Nenhum usuário no arquivo'],
  ])('refuses a file without usable content (%j)', (csv, message) => {
    expect(() => parseUsersCsv(csv)).toThrow(new BadRequestException(message));
  });

  it(`refuses more than ${MAX_IMPORT_ROWS} users per file`, () => {
    const lines = Array.from(
      { length: MAX_IMPORT_ROWS + 1 },
      (_, i) => `U${i};u${i}@exemplo.dev;52998224725;cliente`,
    );
    expect(() =>
      parseUsersCsv(['nome;email;cpf;perfil', ...lines].join('\n')),
    ).toThrow(/o limite é 100/);
  });
});

describe('decodeCsv (BE-01)', () => {
  it('reads UTF-8 and the Windows-1252 that Excel saves by default', () => {
    expect(decodeCsv(Buffer.from('Nome\nJoão', 'utf-8'))).toBe('Nome\nJoão');
    // "João" in Windows-1252: ã = 0xE3
    const ansi = Buffer.from([
      0x4e, 0x6f, 0x6d, 0x65, 0x0a, 0x4a, 0x6f, 0xe3, 0x6f,
    ]);
    expect(decodeCsv(ansi)).toBe('Nome\nJoão');
  });
});
