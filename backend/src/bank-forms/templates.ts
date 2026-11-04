import type { FichaSnapshot } from '../ficha/ficha.service';
import { BuiltForm, buildItauComprador, buildItauSeguro } from './itau';

export interface BankFormTemplate {
  key: string;
  bank: string;
  label: string;
  version: string;
  /** arquivo do modelo: BANK_FORM_TEMPLATES_DIR ou o Blob privado (_templates/) */
  file: string;
  build: (s: FichaSnapshot) => BuiltForm;
}

// Modelos dos bancos. Os PDFs NÃO vão para o repositório (o do Itaú é
// classificado como interno): ficam no container privado do Blob.
export const BANK_FORMS: BankFormTemplate[] = [
  {
    key: 'itau-comprador',
    bank: 'Itaú',
    label: 'Formulário do Comprador (Pessoa Física)',
    version: '02/25',
    file: 'itau-comprador-0225.pdf',
    build: buildItauComprador,
  },
  {
    key: 'itau-seguro',
    bank: 'Itaú',
    label: 'Proposta de Seguro Habitacional (MIP/DFI)',
    version: '05/25',
    file: 'itau-seguro-0525.pdf',
    build: buildItauSeguro,
  },
];

export const BANK_FORM_BY_KEY = new Map(BANK_FORMS.map((t) => [t.key, t]));
