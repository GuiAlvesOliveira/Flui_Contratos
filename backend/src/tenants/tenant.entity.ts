import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 100, unique: true })
  slug: string;

  @Column({ default: true })
  active: boolean;

  // PROD-04: key of the logo in the private container (never sent to the browser)
  @Column({ type: 'varchar', name: 'logo_path', length: 500, nullable: true })
  logoPath: string | null;

  @Column({ type: 'varchar', name: 'logo_mime', length: 50, nullable: true })
  logoMime: string | null;

  @Column({ type: 'timestamptz', name: 'logo_updated_at', nullable: true })
  logoUpdatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
