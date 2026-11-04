import { PDFDocument, PDFRadioGroup, PDFTextField } from 'pdf-lib';
import type { FilledField } from './itau';

// As fontes padrão do PDF só desenham caracteres Latin-1 (o português cabe
// inteiro); o resto perde o acento ou sai do texto, para a geração não falhar.
export function toLatin1(value: string): string {
  return [...value]
    .map((ch) =>
      ch.charCodeAt(0) <= 0xff
        ? ch
        : ch.normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
    )
    .join('')
    .split('')
    .filter((ch) => ch.charCodeAt(0) <= 0xff)
    .join('');
}

/**
 * Preenche o PDF do banco e devolve o arquivo, ainda editável (a equipe pode
 * completar à mão o que faltar). Campo inexistente = o banco trocou o modelo.
 */
export async function fillPdf(
  template: Buffer,
  fields: FilledField[],
): Promise<Buffer> {
  const doc = await PDFDocument.load(template);
  const form = doc.getForm();
  for (const f of fields) {
    const field = form.getFieldMaybe(f.name);
    if (!field)
      throw new Error(`O modelo do banco mudou: campo "${f.name}" não existe`);
    if (f.kind === 'text') {
      if (!(field instanceof PDFTextField))
        throw new Error(`Campo "${f.name}" não é de texto`);
      const max = field.getMaxLength();
      const text = toLatin1(f.value);
      field.setText(max ? text.slice(0, max) : text);
    } else {
      if (!(field instanceof PDFRadioGroup))
        throw new Error(`Campo "${f.name}" não é de opção`);
      field.select(f.value);
    }
  }
  return Buffer.from(await doc.save());
}
