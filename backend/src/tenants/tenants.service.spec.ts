import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { Readable } from 'stream';
import type { RequestUserFull } from '../auth/supabase.guard';
import type { AzureStorageService } from '../common/services/azure-storage.service';
import { Tenant } from './tenant.entity';
import { LOGO_MAX_BYTES, logoType, TenantsService } from './tenants.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const JPG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);
const PDF = Buffer.from('%PDF-1.7 fake pdf');
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

const caller = (overrides: Partial<RequestUserFull> = {}) =>
  ({
    tenantId: 't1',
    userId: 'g1',
    role: 'dono',
    ...overrides,
  }) as RequestUserFull;

const tenant = (overrides: Partial<Tenant> = {}) =>
  ({
    id: 't1',
    name: 'Assessoria Alfa',
    slug: 'alfa',
    active: true,
    logoPath: null,
    logoMime: null,
    logoUpdatedAt: null,
    ...overrides,
  }) as Tenant;

const file = (buffer: Buffer, size = buffer.length) =>
  ({ buffer, size, originalname: 'logo.png' }) as Express.Multer.File;

function setup(current: Tenant | null = tenant(), storageUp = true) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const updates: { id: string; values: Partial<Tenant> }[] = [];
  const manager = {
    update: jest.fn((_e: unknown, id: string, values: Partial<Tenant>) => {
      updates.push({ id, values });
      return Promise.resolve();
    }),
    query: jest.fn((sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return Promise.resolve();
    }),
  };
  const repo = { findOne: jest.fn().mockResolvedValue(current) };
  const storage = {
    isAvailable: storageUp,
    upload: jest.fn<Promise<string>, [string, Buffer, string]>((key) =>
      Promise.resolve(key),
    ),
    delete: jest.fn().mockResolvedValue(true),
    download: jest.fn().mockResolvedValue({
      stream: Readable.from([PNG]),
      contentType: 'application/octet-stream',
      contentLength: PNG.length,
    }),
  };
  const dataSource = {
    transaction: jest.fn((fn: (m: typeof manager) => Promise<unknown>) =>
      fn(manager),
    ),
  };
  const service = new TenantsService(
    repo as unknown as Repository<Tenant>,
    storage as unknown as AzureStorageService,
    dataSource as unknown as DataSource,
  );
  return { service, repo, storage, manager, queries, updates };
}

describe('logoType (PROD-04)', () => {
  it('accepts PNG and JPEG by their bytes', () => {
    expect(logoType(PNG)).toEqual({ mime: 'image/png', ext: 'png' });
    expect(logoType(JPG)).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
  });

  it('refuses PDF, HTML, an empty or missing file', () => {
    expect(logoType(PDF)).toBeNull();
    expect(logoType(HTML)).toBeNull();
    expect(logoType(Buffer.alloc(0))).toBeNull();
    expect(logoType(undefined)).toBeNull();
  });
});

describe('TenantsService — a própria assessoria (PROD-04)', () => {
  it('reads only the caller tenant and never exposes the storage key', async () => {
    const { service, repo } = setup(
      tenant({
        logoPath: 't1/branding/logo-1.png',
        logoMime: 'image/png',
        logoUpdatedAt: new Date('2026-10-19T12:00:00Z'),
      }),
    );
    const view = await service.getMine(caller({ role: 'cliente' }));
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 't1' } });
    expect(view).toEqual({
      id: 't1',
      name: 'Assessoria Alfa',
      slug: 'alfa',
      logo: {
        mimeType: 'image/png',
        updatedAt: new Date('2026-10-19T12:00:00Z'),
      },
    });
    expect(JSON.stringify(view)).not.toContain('branding');
  });

  it('a caller without tenant gets 404', async () => {
    const { service, repo } = setup();
    await expect(
      service.getMine(caller({ tenantId: null })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.findOne).not.toHaveBeenCalled();
  });

  it('renaming writes the new name and the audit entry in one transaction', async () => {
    const { service, updates, queries } = setup();
    const view = await service.updateMine(
      { name: 'Assessoria Beta' },
      caller(),
    );
    expect(view.name).toBe('Assessoria Beta');
    expect(updates).toEqual([
      { id: 't1', values: { name: 'Assessoria Beta' } },
    ]);
    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual([
      't1',
      'g1',
      'tenant_updated',
      'Assessoria Alfa',
      'Assessoria Beta',
      JSON.stringify({
        field: 'name',
        before: 'Assessoria Alfa',
        after: 'Assessoria Beta',
      }),
    ]);
  });

  it('the same name changes nothing and logs nothing', async () => {
    const { service, updates, queries } = setup();
    await service.updateMine({ name: 'Assessoria Alfa' }, caller());
    expect(updates).toHaveLength(0);
    expect(queries).toHaveLength(0);
  });
});

describe('TenantsService — logo (PROD-04)', () => {
  it('stores a PNG under the tenant prefix of the private container and audits it', async () => {
    const { service, storage, updates, queries } = setup();
    const view = await service.uploadLogo(file(PNG), caller());
    const key = storage.upload.mock.calls[0][0];
    expect(key).toMatch(/^t1\/branding\/logo-\d+\.png$/);
    expect(storage.upload).toHaveBeenCalledWith(key, PNG, 'image/png');
    expect(updates[0].values).toMatchObject({
      logoPath: key,
      logoMime: 'image/png',
    });
    expect(queries[0].params[2]).toBe('tenant_logo_updated');
    expect(view.logo?.mimeType).toBe('image/png');
  });

  it('a JPEG is stored with its real type, whatever the declared one', async () => {
    const { service, storage } = setup();
    await service.uploadLogo(file(JPG), caller());
    expect(storage.upload.mock.calls[0][0]).toMatch(/\.jpg$/);
    expect(storage.upload.mock.calls[0][2]).toBe('image/jpeg');
  });

  it.each([
    ['a PDF', PDF],
    ['HTML disguised as an image', HTML],
  ])('refuses %s (400) and stores nothing', async (_c, buffer) => {
    const { service, storage, updates } = setup();
    await expect(
      service.uploadLogo(file(buffer), caller()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('refuses a file over 1 MB and a request without file', async () => {
    const { service, storage } = setup();
    await expect(
      service.uploadLogo(file(PNG, LOGO_MAX_BYTES + 1), caller()),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.uploadLogo(undefined, caller()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('without storage the upload fails with 503 and the row is untouched', async () => {
    const { service, updates } = setup(tenant(), false);
    await expect(
      service.uploadLogo(file(PNG), caller()),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(updates).toHaveLength(0);
  });

  it('replacing the logo removes the previous file after the row points to the new one', async () => {
    const { service, storage, updates } = setup(
      tenant({
        logoPath: 't1/branding/logo-1.png',
        logoMime: 'image/png',
        logoUpdatedAt: new Date(),
      }),
    );
    await service.uploadLogo(file(JPG), caller());
    expect(updates).toHaveLength(1);
    expect(storage.delete).toHaveBeenCalledWith('t1/branding/logo-1.png');
  });

  it('a failure removing the old file does not undo the new logo', async () => {
    const { service, storage } = setup(
      tenant({
        logoPath: 't1/branding/old.png',
        logoMime: 'image/png',
        logoUpdatedAt: new Date(),
      }),
    );
    storage.delete.mockRejectedValueOnce(new Error('timeout'));
    await expect(
      service.uploadLogo(file(PNG), caller()),
    ).resolves.toMatchObject({
      logo: { mimeType: 'image/png' },
    });
  });

  it('serves the logo with the stored type; without logo it is 404', async () => {
    const withLogo = setup(
      tenant({
        logoPath: 't1/branding/logo-1.png',
        logoMime: 'image/png',
        logoUpdatedAt: new Date(),
      }),
    );
    const blob = await withLogo.service.getLogo(
      caller({ role: 'cliente', userId: 'c1' }),
    );
    expect(withLogo.storage.download).toHaveBeenCalledWith(
      't1/branding/logo-1.png',
    );
    expect(blob.contentType).toBe('image/png');

    const none = setup();
    await expect(none.service.getLogo(caller())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(none.storage.download).not.toHaveBeenCalled();
  });

  it('removing deletes the file first, then clears the row with an audit entry', async () => {
    const { service, storage, updates, queries } = setup(
      tenant({
        logoPath: 't1/branding/logo-1.png',
        logoMime: 'image/png',
        logoUpdatedAt: new Date(),
      }),
    );
    const view = await service.removeLogo(caller());
    expect(storage.delete).toHaveBeenCalledWith('t1/branding/logo-1.png');
    expect(updates[0].values).toMatchObject({ logoPath: null, logoMime: null });
    expect(queries[0].params[2]).toBe('tenant_logo_removed');
    expect(view.logo).toBeNull();
  });
});
