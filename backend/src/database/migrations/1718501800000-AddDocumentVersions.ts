import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PROD-12: histórico de documentos. Cada envio de arquivo vira uma versão com
 * o seu próprio blob — reenviar não apaga nem sobrescreve a anterior. A linha
 * de documents continua sendo a versão atual (blob_path, status e validação),
 * que é a única que a trava do RN-04 considera; cada versão guarda quem enviou,
 * quando e o resultado da validação dela. A exclusão LGPD (BE-10) apaga o
 * documento e, em cascata, todas as versões.
 * Documentos que já têm arquivo ganham a versão 1, com a data do último envio
 * registrado no Log de Ações (ou a criação do documento) e o resultado atual.
 */
export class AddDocumentVersions1718501800000 implements MigrationInterface {
  name = 'AddDocumentVersions1718501800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS document_versions (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    UUID NOT NULL REFERENCES tenants(id),
        document_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        version      INTEGER NOT NULL CHECK (version >= 1),
        blob_path    VARCHAR(500) NOT NULL,
        mime_type    VARCHAR(100),
        size_bytes   BIGINT,
        uploaded_by  UUID REFERENCES users(id),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        status       VARCHAR(20) NOT NULL DEFAULT 'recebido'
                     CHECK (status IN ('recebido', 'validado', 'rejeitado')),
        reviewed_by  UUID REFERENCES users(id),
        reviewed_at  TIMESTAMPTZ,
        review_notes TEXT,
        UNIQUE (document_id, version)
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_document_versions_tenant
         ON document_versions (tenant_id, document_id)`,
    );
    await queryRunner.query(`
      INSERT INTO document_versions
        (tenant_id, document_id, version, blob_path, mime_type, size_bytes,
         uploaded_by, created_at, status, reviewed_by, reviewed_at, review_notes)
      SELECT d.tenant_id, d.id, 1, d.blob_path, d.mime_type, d.size_bytes, d.uploaded_by,
             COALESCE((SELECT max(al.created_at) FROM audit_logs al
                        WHERE al.action = 'document_upload'
                          AND al.metadata->>'docId' = d.id::text), d.created_at),
             CASE WHEN d.status IN ('validado', 'rejeitado') THEN d.status ELSE 'recebido' END,
             CASE WHEN d.status = 'validado' THEN d.validated_by END,
             CASE WHEN d.status = 'validado' THEN d.validated_at END,
             CASE WHEN d.status = 'rejeitado' THEN d.validated_by_notes END
        FROM documents d
       WHERE d.blob_path IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM document_versions v WHERE v.document_id = d.id)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS document_versions`);
  }
}
