import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import { STAGE_LABELS, type ProcessStage } from '../processes/process.entity';

export const SEARCH_MIN_LENGTH = 3;
const LIMIT = 5;

// Text for ILIKE: %, _ and \ are taken literally.
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// "CLI-0392" or "0392": start of the process id (the code the app shows)
export function codePrefix(q: string): string | null {
  const code = q.toLowerCase().replace(/^cli-?/, '');
  return /^[0-9a-f]{3,4}$/.test(code) ? `${code}%` : null;
}

const fullName = (name: string | null, surname: string | null, email: string) =>
  [name, surname].filter(Boolean).join(' ') || email;
const shortCode = (id: string) =>
  `CLI-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;

@Injectable()
export class SearchService {
  constructor(private readonly dataSource: DataSource) {}

  // FE-30: busca global da topbar. Tudo dentro do tenant; o analista só acha
  // os próprios processos e os proponentes deles (mesma visibilidade de
  // GET /processes). O CPF entra na busca mas não volta na resposta.
  async search(q: string, caller: RequestUserFull) {
    const text = q.trim();
    if (text.length < SEARCH_MIN_LENGTH) {
      return { empreendimentos: [], proponentes: [], processos: [] };
    }
    const like = likePattern(text);
    const digits = text.replace(/\D/g, '');
    const cpfLike = digits.length >= SEARCH_MIN_LENGTH ? `%${digits}%` : null;
    const code = codePrefix(text);
    const own = caller.role === 'analista' ? caller.userId : null;

    const empreendimentos = await this.dataSource.query<
      { id: string; nome: string; endereco: string }[]
    >(
      `SELECT id, nome, endereco FROM empreendimentos
        WHERE tenant_id = $1 AND active = true
          AND (nome ILIKE $2 OR endereco ILIKE $2 OR matricula_mae ILIKE $2)
        ORDER BY nome LIMIT ${LIMIT}`,
      [caller.tenantId, like],
    );

    const proponentes = await this.dataSource.query<
      {
        id: string;
        name: string | null;
        surname: string | null;
        email: string;
        process_id: string | null;
      }[]
    >(
      `SELECT c.id, c.name, c.surname, c.email,
              (SELECT p.id FROM processes p
                WHERE p.client_id = c.id AND p.tenant_id = $1 AND p.active = true
                  AND ($4::uuid IS NULL OR p.analista_id = $4)
                ORDER BY p.updated_at DESC LIMIT 1) AS process_id
         FROM users c
        WHERE c.tenant_id = $1 AND c.role = 'cliente'
          AND (concat_ws(' ', c.name, c.surname) ILIKE $2 OR c.email ILIKE $2
               OR ($3::text IS NOT NULL
                   AND regexp_replace(coalesce(c.cpf, ''), '\\D', '', 'g') LIKE $3))
          AND ($4::uuid IS NULL OR EXISTS (
                SELECT 1 FROM processes p
                 WHERE p.client_id = c.id AND p.tenant_id = $1
                   AND p.active = true AND p.analista_id = $4))
        ORDER BY c.name NULLS LAST, c.email LIMIT ${LIMIT}`,
      [caller.tenantId, like, cpfLike, own],
    );

    const processos = await this.dataSource.query<
      {
        id: string;
        stage: ProcessStage;
        name: string | null;
        surname: string | null;
        email: string;
        unidade: string | null;
        empreendimento: string | null;
      }[]
    >(
      `SELECT p.id, p.stage, c.name, c.surname, c.email,
              un.identificacao AS unidade, e.nome AS empreendimento
         FROM processes p
         JOIN users c ON c.id = p.client_id
         LEFT JOIN unidades un ON un.id = p.unidade_id
         LEFT JOIN empreendimentos e ON e.id = un.empreendimento_id
        WHERE p.tenant_id = $1 AND p.active = true
          AND ($4::uuid IS NULL OR p.analista_id = $4)
          AND (concat_ws(' ', c.name, c.surname) ILIKE $2 OR c.email ILIKE $2
               OR un.identificacao ILIKE $2 OR e.nome ILIKE $2
               OR ($3::text IS NOT NULL AND replace(p.id::text, '-', '') LIKE $3))
        ORDER BY p.updated_at DESC LIMIT ${LIMIT}`,
      [caller.tenantId, like, code, own],
    );

    return {
      empreendimentos: empreendimentos.map((e) => ({
        id: e.id,
        title: e.nome,
        sub: e.endereco,
      })),
      proponentes: proponentes.map((c) => ({
        id: c.id,
        processId: c.process_id,
        title: fullName(c.name, c.surname, c.email),
        sub: c.email,
      })),
      processos: processos.map((p) => ({
        id: p.id,
        title: `${shortCode(p.id)} · ${fullName(p.name, p.surname, p.email)}`,
        sub: [
          STAGE_LABELS[p.stage] ?? p.stage,
          [p.empreendimento, p.unidade].filter(Boolean).join(' '),
        ]
          .filter(Boolean)
          .join(' · '),
      })),
    };
  }
}
