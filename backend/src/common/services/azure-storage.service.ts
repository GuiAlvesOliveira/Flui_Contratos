import { Injectable, Logger } from '@nestjs/common';
import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import type { Readable } from 'stream';

export interface BlobDownload {
  stream: Readable;
  contentType: string;
  contentLength: number | undefined;
}

@Injectable()
export class AzureStorageService {
  private readonly logger = new Logger(AzureStorageService.name);
  private containerClient: ContainerClient | null = null;

  async onModuleInit() {
    const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
    const container = process.env.AZURE_STORAGE_CONTAINER ?? 'documentos';

    if (!connStr) {
      this.logger.warn('AZURE_STORAGE_CONNECTION_STRING not set — file uploads stored locally');
      return;
    }

    try {
      const client = BlobServiceClient.fromConnectionString(connStr);
      this.containerClient = client.getContainerClient(container);
      // Private container — the blob URL never leaves the backend
      await this.containerClient.createIfNotExists();
      this.logger.log(`Azure Blob Storage ready (container: ${container}, private)`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
      this.logger.warn(`Azure Blob Storage unavailable (uploads disabled): ${msg}`);
      this.containerClient = null;
    }
  }

  get isAvailable(): boolean {
    return this.containerClient !== null;
  }

  // Returns the blobName (key) — the storage URL never leaves the backend
  async upload(blobName: string, buffer: Buffer, mimeType: string): Promise<string> {
    if (!this.containerClient) throw new Error('Azure Storage not configured');
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.upload(buffer, buffer.length, {
      blobHTTPHeaders: { blobContentType: mimeType },
    });
    return blobName;
  }

  // Downloads the blob and returns a raw stream — caller pipes it to the HTTP response.
  // The blob URL is never exposed; the backend is the only transport.
  async download(blobName: string): Promise<BlobDownload> {
    if (!this.containerClient) throw new Error('Azure Storage not configured');
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
    const resp = await blockBlobClient.download(0);
    if (!resp.readableStreamBody) throw new Error('Empty blob response');
    return {
      stream: resp.readableStreamBody as Readable,
      contentType: resp.contentType ?? 'application/octet-stream',
      contentLength: resp.contentLength,
    };
  }
}
