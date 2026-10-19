import { deflateSync } from 'zlib';

/**
 * PROD-03: PDF mínimo, sem dependência externa — páginas A4 com texto nas
 * fontes padrão do PDF (Helvetica e Helvetica-Bold, que todo leitor tem),
 * retângulos e linhas. Coordenadas em pontos a partir do canto superior
 * esquerdo; o texto vai em WinAnsi (cobre os acentos do português).
 */
export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export type Rgb = [number, number, number];

// Larguras (em 1/1000 do corpo) dos caracteres 32..126 — métricas AFM padrão
// prettier-ignore
const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
// prettier-ignore
const HELVETICA_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

// Caracteres fora do ASCII que o WinAnsi tem em posições próprias
const WIN_ANSI_EXTRA: Record<string, [number, number]> = {
  '€': [0x80, 556], // €
  '…': [0x85, 1000], // …
  '‘': [0x91, 222],
  '’': [0x92, 222],
  '“': [0x93, 333],
  '”': [0x94, 333],
  '•': [0x95, 350], // •
  '–': [0x96, 556], // –
  '—': [0x97, 1000], // —
};

function charInfo(ch: string, bold: boolean): [number, number] {
  const code = ch.charCodeAt(0);
  const table = bold ? HELVETICA_BOLD : HELVETICA;
  if (code >= 32 && code <= 126) return [code, table[code - 32]];
  if (WIN_ANSI_EXTRA[ch]) return WIN_ANSI_EXTRA[ch];
  if (code === 0xa0) return [0xa0, 278]; // espaço sem quebra (R$ 1.000,00)
  if (code === 0xb7) return [0xb7, 278]; // ·
  if (code === 0xb0) return [0xb0, 400]; // °
  if (code >= 0xa1 && code <= 0xff) {
    // letras acentuadas: largura da letra base (á → a)
    const base = ch.normalize('NFD').charCodeAt(0);
    return [code, base >= 32 && base <= 126 ? table[base - 32] : 556];
  }
  return [0x3f, table[0x3f - 32]]; // "?"
}

const normalize = (s: string) =>
  s.replace(/→/g, '->').replace(/[\r\n\t]+/g, ' ');

export function textWidth(text: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of normalize(text)) w += charInfo(ch, bold)[1];
  return (w * size) / 1000;
}

export function winAnsi(text: string, bold = false): Buffer {
  return Buffer.from([...normalize(text)].map((ch) => charInfo(ch, bold)[0]));
}

// Corta o texto para caber na largura, terminando em "…"
export function fit(
  text: string,
  maxWidth: number,
  size: number,
  bold = false,
): string {
  if (textWidth(text, size, bold) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && textWidth(`${out}…`, size, bold) > maxWidth)
    out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

const num = (n: number) => (Math.round(n * 100) / 100).toString();
const rgb = ([r, g, b]: Rgb) =>
  `${num(r / 255)} ${num(g / 255)} ${num(b / 255)}`;

export interface TextOptions {
  size?: number;
  bold?: boolean;
  color?: Rgb;
  align?: 'left' | 'right' | 'center';
}

export class PdfDoc {
  private readonly pages: string[][] = [];
  private current = 0;

  constructor(private readonly title = 'Documento') {
    this.addPage();
  }

  get pageCount() {
    return this.pages.length;
  }

  addPage(): void {
    this.pages.push([]);
    this.current = this.pages.length - 1;
  }

  /** Desenha numa página já criada (ex.: rodapé "página X de Y" no fim). */
  onPage(index: number, draw: () => void): void {
    const before = this.current;
    this.current = index;
    draw();
    this.current = before;
  }

  text(x: number, y: number, value: string, o: TextOptions = {}): void {
    const size = o.size ?? 10;
    const bold = !!o.bold;
    const w = textWidth(value, size, bold);
    const tx =
      o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    this.pages[this.current].push(
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb(o.color ?? [24, 24, 27])} rg ${num(tx)} ${num(PAGE_H - y)} Td <${winAnsi(value, bold).toString('hex')}> Tj ET`,
    );
  }

  rect(x: number, y: number, w: number, h: number, fill: Rgb): void {
    this.pages[this.current].push(
      `${rgb(fill)} rg ${num(x)} ${num(PAGE_H - y - h)} ${num(w)} ${num(h)} re f`,
    );
  }

  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: Rgb = [228, 228, 231],
    width = 0.75,
  ): void {
    this.pages[this.current].push(
      `${rgb(color)} RG ${num(width)} w ${num(x1)} ${num(PAGE_H - y1)} m ${num(x2)} ${num(PAGE_H - y2)} l S`,
    );
  }

  toBuffer(): Buffer {
    const objects: Buffer[] = [];
    const add = (body: Buffer | string) => {
      objects.push(
        typeof body === 'string' ? Buffer.from(body, 'latin1') : body,
      );
      return objects.length; // número do objeto
    };
    const font = (name: string) =>
      `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;

    add('<< /Type /Catalog /Pages 2 0 R >>'); // 1
    add(''); // 2: /Pages, preenchido depois que as páginas existem
    const f1 = add(font('Helvetica'));
    const f2 = add(font('Helvetica-Bold'));
    const kids: number[] = [];
    for (const ops of this.pages) {
      const stream = deflateSync(Buffer.from(ops.join('\n'), 'latin1'));
      const content = add(
        Buffer.concat([
          Buffer.from(
            `<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`,
            'latin1',
          ),
          stream,
          Buffer.from('\nendstream', 'latin1'),
        ]),
      );
      kids.push(
        add(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`,
        ),
      );
    }
    objects[1] = Buffer.from(
      `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`,
      'latin1',
    );
    const info = add(
      `<< /Title <${Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(this.title, 'utf16le').swap16()]).toString('hex')}> /Producer (Flui Contratos) >>`,
    );

    const chunks: Buffer[] = [
      Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1'),
    ];
    let offset = chunks[0].length;
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(offset);
      const obj = Buffer.concat([
        Buffer.from(`${i + 1} 0 obj\n`, 'latin1'),
        body,
        Buffer.from('\nendobj\n', 'latin1'),
      ]);
      chunks.push(obj);
      offset += obj.length;
    });
    const xref = [
      'xref',
      `0 ${objects.length + 1}`,
      '0000000000 65535 f ',
      ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `),
      'trailer',
      `<< /Size ${objects.length + 1} /Root 1 0 R /Info ${info} 0 R >>`,
      'startxref',
      String(offset),
      '%%EOF',
      '',
    ].join('\n');
    chunks.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(chunks);
  }
}
