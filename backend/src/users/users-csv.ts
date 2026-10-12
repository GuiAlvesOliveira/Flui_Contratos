import { BadRequestException } from '@nestjs/common';
import { isEmail } from 'class-validator';
import type { CreateUserDto } from './dto/create-user.dto';

export const MAX_IMPORT_ROWS = 100;

export interface CsvUserRow {
  line: number;
  name: string;
  email: string;
  role: string;
  dto?: CreateUserDto;
  error?: string;
}

type Field = 'name' | 'surname' | 'email' | 'cpf' | 'role';

const HEADER_ALIASES: Record<string, Field> = {
  nome: 'name',
  name: 'name',
  nomecompleto: 'name',
  sobrenome: 'surname',
  surname: 'surname',
  email: 'email',
  cpf: 'cpf',
  perfil: 'role',
  papel: 'role',
  role: 'role',
  tipo: 'role',
};

const ROLE_ALIASES: Record<string, CreateUserDto['role']> = {
  analista: 'analista',
  cliente: 'cliente',
  gestor: 'dono',
  dono: 'dono',
};

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

// Excel in Brazil saves "CSV" as Windows-1252 unless "CSV UTF-8" is chosen;
// anything that is not valid UTF-8 is read as Windows-1252.
export function decodeCsv(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

// RFC 4180 with the delimiter of the header line (";" from Excel pt-BR, or ",").
function splitCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delim =
    (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0)
      ? ';'
      : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * BE-01: reads the import file (columns nome; sobrenome; email; cpf; perfil,
 * in any order) and checks each line on its own, so one bad line does not
 * stop the others. File-level problems throw BadRequestException.
 */
export function parseUsersCsv(text: string): CsvUserRow[] {
  const noBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const all = splitCsv(noBom);
  const [header, ...body] = all;
  if (!header) throw new BadRequestException('O arquivo está vazio');

  const columns = header.map((h) => HEADER_ALIASES[normalize(h)]);
  const missing = (['name', 'email', 'role'] as Field[]).filter(
    (f) => !columns.includes(f),
  );
  if (missing.length > 0) {
    throw new BadRequestException(
      'O cabeçalho precisa das colunas nome, email e perfil (sobrenome e cpf são opcionais)',
    );
  }

  const lines = body
    .map((cells, i) => ({ cells, line: i + 2 }))
    .filter(({ cells }) => cells.some((c) => c.trim() !== ''));
  if (lines.length === 0) {
    throw new BadRequestException('Nenhum usuário no arquivo');
  }
  if (lines.length > MAX_IMPORT_ROWS) {
    throw new BadRequestException(
      `O arquivo tem ${lines.length} usuários; o limite é ${MAX_IMPORT_ROWS} por importação`,
    );
  }

  const seen = new Map<string, number>();
  return lines.map(({ cells, line }) => {
    const get = (f: Field) => {
      const idx = columns.indexOf(f);
      return idx >= 0 ? (cells[idx] ?? '').trim() : '';
    };
    const name = get('name');
    const email = get('email').toLowerCase();
    const rawRole = get('role');
    const role = ROLE_ALIASES[normalize(rawRole)];
    const cpf = get('cpf').replace(/\D/g, '');
    const row: CsvUserRow = { line, name, email, role: role ?? rawRole };

    let error: string | undefined;
    if (!name) error = 'Nome em branco';
    else if (!isEmail(email)) error = 'E-mail inválido';
    else if (!role) error = 'Perfil inválido: use analista ou cliente';
    else if (seen.has(email))
      error = `E-mail repetido no arquivo (linha ${seen.get(email)})`;
    else if (role !== 'dono' && !cpf) error = 'CPF obrigatório';
    else if (cpf && cpf.length !== 11) error = 'CPF deve ter 11 dígitos';
    if (email && !seen.has(email)) seen.set(email, line);
    if (error) return { ...row, error };

    return {
      ...row,
      dto: {
        name,
        email,
        role,
        surname: get('surname') || undefined,
        cpf: cpf || undefined,
      },
    };
  });
}
