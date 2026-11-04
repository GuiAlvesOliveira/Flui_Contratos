import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import { MessagingService } from '../messaging/messaging.service';
import { ProcessParticipant } from '../participants/participant.entity';
import { Process } from '../processes/process.entity';
import { User } from '../users/user.entity';
import {
  FICHA_FIELDS,
  FICHA_GROUPS,
  FichaField,
  FichaTarget,
  PESSOA_BASE_KEYS,
  fichaLabel,
  parseFichaKey,
} from './ficha-fields';
import { FichaValue, normalizeFichaValue } from './ficha-values';

export type FichaValues = Record<string, FichaValue>;
export interface FichaBody {
  cliente?: Record<string, unknown>;
  segundo?: Record<string, unknown>;
  processo?: Record<string, unknown>;
}

interface Entry {
  target: FichaTarget;
  field: FichaField;
  value: FichaValue;
}

const PESSOA_FIELDS = FICHA_FIELDS.filter((f) => f.scope === 'pessoa');
const PROCESSO_FIELDS = FICHA_FIELDS.filter((f) => f.scope === 'processo');
const BASE = new Set<string>(PESSOA_BASE_KEYS);
const ENDERECO = [
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'cidade',
  'uf',
];

type Pessoa = User | ProcessParticipant;

function readPessoa(p: Pessoa, estadoCivil?: string | null): FichaValues {
  const out: FichaValues = {};
  const ficha = (p.ficha ?? {}) as unknown as Record<string, FichaValue>;
  for (const f of PESSOA_FIELDS) {
    const raw = BASE.has(f.key)
      ? ((p as unknown as Record<string, FichaValue>)[f.key] ?? null)
      : (ficha[f.key] ?? null);
    out[f.key] = raw;
  }
  if (estadoCivil) out.estadoCivil = estadoCivil;
  return out;
}

function readProcesso(p: Process): FichaValues {
  const out: FichaValues = {};
  for (const f of PROCESSO_FIELDS) {
    const raw = (p as unknown as Record<string, FichaValue>)[f.key] ?? null;
    out[f.key] = f.type === 'percent' && raw !== null ? Number(raw) : raw;
  }
  return out;
}

// "Rua X, 123 - ap 4, Bairro, Cidade - UF": o texto antigo que as telas mostram
export function composeEndereco(v: FichaValues): string | null {
  const rua = [v.logradouro, v.numero].filter(Boolean).join(', ');
  const ruaCompl = [rua, v.complemento].filter(Boolean).join(' - ');
  const cidade = [v.cidade, v.uf].filter(Boolean).join(' - ');
  const text = [ruaCompl, v.bairro, cidade].filter(Boolean).join(', ');
  return text ? text.slice(0, 255) : null;
}

export interface FichaSnapshot {
  process: Process;
  cliente: FichaValues & {
    nome: string | null;
    cpf: string | null;
    email: string | null;
  };
  segundo:
    | (FichaValues & { id: string; nome: string; cpf: string | null })
    | null;
  processo: FichaValues;
  participantCount: number;
}

@Injectable()
export class FichaService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly messaging: MessagingService,
  ) {}

  fields() {
    return { groups: FICHA_GROUPS, fields: FICHA_FIELDS };
  }

  private async loadProcess(
    m: EntityManager,
    processId: string,
    caller: RequestUserFull,
    lock = false,
  ) {
    const process = await m.findOne(Process, {
      where: { id: processId, tenantId: caller.tenantId! },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    // o cliente só enxerga o próprio processo (RN-01: outro = inexistente)
    if (
      !process ||
      (caller.role === 'cliente' && process.clientId !== caller.userId)
    ) {
      throw new NotFoundException('Processo não encontrado');
    }
    return process;
  }

  /** dados reunidos para a ficha e os formulários do banco */
  async snapshot(
    processId: string,
    caller: RequestUserFull,
    m = this.dataSource.manager,
  ): Promise<FichaSnapshot> {
    const process = await this.loadProcess(m, processId, caller);
    const tenantId = caller.tenantId!;
    const client = await m.findOne(User, {
      where: { id: process.clientId, tenantId },
    });
    const participants = await m.find(ProcessParticipant, {
      where: { processId, tenantId },
      order: { createdAt: 'ASC' },
    });
    const seg =
      participants.find((p) => p.id === process.segundoCompradorId) ?? null;
    return {
      process,
      cliente: {
        ...(client
          ? readPessoa(client, process.estadoCivil ?? client.estadoCivil)
          : {}),
        nome: client
          ? [client.name, client.surname].filter(Boolean).join(' ') || null
          : null,
        cpf: client?.cpf ?? null,
        email: client?.email ?? null,
      },
      segundo: seg
        ? { ...readPessoa(seg), id: seg.id, nome: seg.name, cpf: seg.cpf }
        : null,
      processo: readProcesso(process),
      participantCount: participants.length,
    };
  }

  async getFicha(processId: string, caller: RequestUserFull) {
    const s = await this.snapshot(processId, caller);
    const participants = await this.dataSource.manager.find(
      ProcessParticipant,
      {
        where: { processId, tenantId: caller.tenantId! },
        order: { createdAt: 'ASC' },
      },
    );
    return {
      cliente: s.cliente,
      segundo: s.segundo,
      processo: s.processo,
      participants: participants.map((p) => ({
        id: p.id,
        name: p.name,
        cpf: p.cpf,
      })),
    };
  }

  private toEntries(body: FichaBody, allowed?: Set<string>): Entry[] {
    const entries: Entry[] = [];
    const errors: string[] = [];
    for (const target of ['processo', 'cliente', 'segundo'] as const) {
      const values = body[target];
      if (values === undefined || values === null) continue;
      if (typeof values !== 'object' || Array.isArray(values)) {
        errors.push(`${target}: formato inválido`);
        continue;
      }
      for (const [key, raw] of Object.entries(values)) {
        const fullKey = `${target}.${key}`;
        const parsed = parseFichaKey(fullKey);
        if (!parsed || (allowed && !allowed.has(fullKey))) {
          errors.push(`Campo não permitido: ${fullKey}`);
          continue;
        }
        const n = normalizeFichaValue(parsed.field, raw);
        if ('error' in n) errors.push(n.error);
        else entries.push({ target, field: parsed.field, value: n.value });
      }
    }
    if (errors.length > 0) throw new BadRequestException(errors);
    return entries;
  }

  // Grava as entradas já validadas; devolve as chaves gravadas (sem valores)
  private async apply(
    m: EntityManager,
    process: Process,
    entries: Entry[],
  ): Promise<string[]> {
    const tenantId = process.tenantId;
    const of = (t: FichaTarget) => entries.filter((e) => e.target === t);

    const proc = of('processo');
    const procPatch: Record<string, FichaValue> = {};
    for (const e of proc) procPatch[e.field.key] = e.value;
    if (typeof procPatch.segundoCompradorId === 'string') {
      const ok = await m.count(ProcessParticipant, {
        where: {
          id: procPatch.segundoCompradorId,
          processId: process.id,
          tenantId,
        },
      });
      if (!ok)
        throw new BadRequestException(
          'O 2º comprador precisa ser um participante deste processo',
        );
    }

    const cli = of('cliente');
    if (cli.some((e) => e.field.key === 'estadoCivil')) {
      procPatch.estadoCivil = cli.find(
        (e) => e.field.key === 'estadoCivil',
      )!.value;
    }
    if (Object.keys(procPatch).length > 0) {
      await m.update(Process, { id: process.id, tenantId }, procPatch);
      Object.assign(process, procPatch);
    }

    const pessoa = async (target: 'cliente' | 'segundo', list: Entry[]) => {
      if (list.length === 0) return;
      const id =
        target === 'cliente' ? process.clientId : process.segundoCompradorId;
      if (!id)
        throw new BadRequestException(
          'Defina o 2º comprador antes de preencher os dados dele',
        );
      const current: Pessoa | null =
        target === 'cliente'
          ? await m.findOne(User, { where: { id, tenantId } })
          : await m.findOne(ProcessParticipant, { where: { id, tenantId } });
      if (!current) throw new NotFoundException('Pessoa não encontrada');
      const base: Record<string, FichaValue> = {};
      const ficha: Record<string, FichaValue> = {};
      for (const e of list)
        (BASE.has(e.field.key) ? base : ficha)[e.field.key] = e.value;
      const patch: Record<string, unknown> = { ...base };
      if (Object.keys(ficha).length > 0) patch.ficha = ficha;
      if (
        target === 'cliente' &&
        list.some((e) => ENDERECO.includes(e.field.key))
      ) {
        patch.endereco = composeEndereco({ ...readPessoa(current), ...ficha });
      }
      // o patch só tem chaves da lista de campos (validadas acima)
      await m.update(
        target === 'cliente' ? User : ProcessParticipant,
        { id, tenantId },
        patch,
      );
    };
    await pessoa('cliente', cli);
    await pessoa('segundo', of('segundo'));
    return entries.map((e) => `${e.target}.${e.field.key}`);
  }

  private audit(
    m: EntityManager,
    process: Process,
    caller: RequestUserFull,
    action: string,
    metadata: object,
  ) {
    return m.query(
      `INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        process.tenantId,
        process.id,
        caller.userId,
        action,
        JSON.stringify(metadata),
      ],
    );
  }

  async patchFicha(
    processId: string,
    body: FichaBody,
    caller: RequestUserFull,
  ) {
    const entries = this.toEntries(body);
    if (entries.length === 0)
      throw new BadRequestException('Nenhum dado para salvar');
    await this.dataSource.transaction(async (m) => {
      const process = await this.loadProcess(m, processId, caller, true);
      const fields = await this.apply(m, process, entries);
      // RN-07: quem mudou o quê (só as chaves, nunca os valores pessoais)
      await this.audit(m, process, caller, 'ficha_updated', { fields });
    });
    return this.getFicha(processId, caller);
  }

  // ── Pedidos de dados ao cliente ─────────────────────────────────────────────

  async createRequest(
    processId: string,
    dto: { fields: string[]; note?: string },
    caller: RequestUserFull,
  ) {
    const keys = [...new Set(dto.fields ?? [])];
    const errors: string[] =
      keys.length === 0 ? ['Escolha ao menos um dado'] : [];
    for (const k of keys) {
      const parsed = parseFichaKey(k);
      if (!parsed || parsed.field.type === 'participant')
        errors.push(`Campo não permitido: ${k}`);
    }
    if (errors.length > 0) throw new BadRequestException(errors);
    const note = dto.note?.trim().slice(0, 500) || null;
    const labels = keys.map(fichaLabel);

    return this.dataSource.transaction(async (m) => {
      const process = await this.loadProcess(m, processId, caller);
      if (
        keys.some((k) => k.startsWith('segundo.')) &&
        !process.segundoCompradorId
      ) {
        throw new BadRequestException(
          'Defina o 2º comprador antes de pedir os dados dele',
        );
      }
      const [row] = await m.query<{ id: string; created_at: Date }[]>(
        `INSERT INTO data_requests (tenant_id, process_id, client_id, fields, note, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
        [
          process.tenantId,
          process.id,
          process.clientId,
          keys,
          note,
          caller.userId,
        ],
      );
      await this.audit(m, process, caller, 'data_requested', {
        requestId: row.id,
        labels,
      });
      // RN-08: o aviso ao cliente entra na fila na mesma transação
      await this.messaging.dataRequested(m, {
        tenantId: process.tenantId,
        processId: process.id,
        clientId: process.clientId,
        labels,
      });
      return {
        id: row.id,
        fields: keys,
        labels,
        note,
        status: 'pendente',
        createdAt: row.created_at,
        answeredAt: null,
      };
    });
  }

  async listRequests(processId: string, caller: RequestUserFull) {
    const m = this.dataSource.manager;
    const isCliente = caller.role === 'cliente';
    const process = await this.loadProcess(m, processId, caller);
    const rows: {
      id: string;
      fields: string[];
      note: string | null;
      status: string;
      created_at: Date;
      answered_at: Date | null;
      requested_by_name: string | null;
    }[] = await m.query(
      `SELECT r.id, r.fields, r.note, r.status, r.created_at, r.answered_at,
              u.name AS requested_by_name
         FROM data_requests r LEFT JOIN users u ON u.id = r.requested_by
        WHERE r.tenant_id = $1 AND r.process_id = $2
          ${isCliente ? `AND r.status = 'pendente'` : ''}
        ORDER BY r.created_at DESC LIMIT 20`,
      [caller.tenantId, process.id],
    );
    // o cliente recebe o valor atual de cada campo pedido, para conferir
    const snap =
      isCliente && rows.length > 0
        ? await this.snapshot(processId, caller, m)
        : null;
    return rows.map((r) => ({
      id: r.id,
      fields: r.fields,
      labels: r.fields.map(fichaLabel),
      note: r.note,
      status: r.status,
      createdAt: r.created_at,
      answeredAt: r.answered_at,
      requestedBy: r.requested_by_name,
      ...(snap
        ? {
            values: Object.fromEntries(
              r.fields.map((k) => [k, valueOf(snap, k)]),
            ),
          }
        : {}),
    }));
  }

  async answerRequest(
    processId: string,
    requestId: string,
    values: Record<string, unknown>,
    caller: RequestUserFull,
  ) {
    await this.dataSource.transaction(async (m) => {
      const process = await this.loadProcess(m, processId, caller, true);
      const [row] = await m.query<
        { id: string; fields: string[]; status: string }[]
      >(
        `SELECT id, fields, status FROM data_requests
          WHERE id = $1 AND process_id = $2 AND tenant_id = $3 FOR UPDATE`,
        [requestId, process.id, process.tenantId],
      );
      if (!row) throw new NotFoundException('Pedido não encontrado');
      if (row.status !== 'pendente')
        throw new ConflictException(
          'Este pedido já foi respondido ou cancelado',
        );

      const body: FichaBody = {};
      for (const [fullKey, v] of Object.entries(values ?? {})) {
        const [target, key] = fullKey.split('.');
        if (
          target !== 'cliente' &&
          target !== 'segundo' &&
          target !== 'processo'
        ) {
          throw new BadRequestException([`Campo não permitido: ${fullKey}`]);
        }
        (body[target] ??= {})[key] = v;
      }
      const entries = this.toEntries(body, new Set(row.fields));
      const fields =
        entries.length > 0 ? await this.apply(m, process, entries) : [];
      await m.query(
        `UPDATE data_requests SET status = 'respondido', answered_at = now() WHERE id = $1`,
        [row.id],
      );
      await this.audit(m, process, caller, 'data_request_answered', {
        requestId: row.id,
        fields,
        labels: fields.map(fichaLabel),
      });
    });
    return { id: requestId, status: 'respondido' };
  }

  async cancelRequest(
    processId: string,
    requestId: string,
    caller: RequestUserFull,
  ) {
    const process = await this.loadProcess(
      this.dataSource.manager,
      processId,
      caller,
    );
    const result = await this.dataSource.query<{ id: string }[]>(
      `WITH upd AS (
         UPDATE data_requests SET status = 'cancelado'
          WHERE id = $1 AND process_id = $2 AND tenant_id = $3 AND status = 'pendente'
          RETURNING id)
       SELECT id FROM upd`,
      [requestId, process.id, process.tenantId],
    );
    if (result.length === 0)
      throw new NotFoundException('Pedido pendente não encontrado');
    return { id: requestId, status: 'cancelado' };
  }
}

/** valor atual de `cliente.x` / `segundo.x` / `processo.x` num snapshot */
export function valueOf(s: FichaSnapshot, fullKey: string): FichaValue {
  const [target, key] = fullKey.split('.');
  const src =
    target === 'cliente'
      ? s.cliente
      : target === 'segundo'
        ? s.segundo
        : s.processo;
  return src?.[key] ?? null;
}
