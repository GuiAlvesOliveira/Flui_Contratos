import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SEC-02 / INFRA-16: replaces the `users.active` boolean with an explicit
 * account state, `status` = invited | active | disabled.
 *
 * With only a boolean, "invited, never logged in" and "deactivated on purpose"
 * looked the same, so the TenantGuard auto-reactivated deactivated invitees on
 * their next login. Backfill (runs once, while `active` still exists):
 *   - active = true                                        → active
 *   - inactive, invite still pending (invited_at set and
 *     onboarding not completed)                            → invited
 *   - any other inactive user (deactivated or removed)     → disabled
 * Users created with a temporary password (createAnalista) start active and
 * have no invited_at, so an inactive one was necessarily deactivated.
 */
export class AddUserStatus1718500300000 implements MigrationInterface {
  name = 'AddUserStatus1718500300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(10)`,
    );

    if (await queryRunner.hasColumn('users', 'active')) {
      await queryRunner.query(
        `UPDATE users
            SET status = CASE
                  WHEN active THEN 'active'
                  WHEN invited_at IS NOT NULL AND NOT onboarding_completed THEN 'invited'
                  ELSE 'disabled'
                END
          WHERE status IS NULL`,
      );
      await queryRunner.query(`ALTER TABLE users DROP COLUMN active`);
    }

    await queryRunner.query(
      `UPDATE users SET status = 'active' WHERE status IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE users ALTER COLUMN status SET DEFAULT 'active'`,
    );
    await queryRunner.query(
      `ALTER TABLE users ALTER COLUMN status SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD CONSTRAINT users_status_check
       CHECK (status IN ('invited', 'active', 'disabled'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true`,
    );
    await queryRunner.query(`UPDATE users SET active = (status <> 'disabled')`);
    await queryRunner.query(
      `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check`,
    );
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS status`);
  }
}
