import { Migration } from '@mikro-orm/migrations';

export class Migration20261020120000_manufacturing extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "manufacturing_operations" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "operation_id" uuid not null, "action" text not null, "order_id" uuid not null, "payload_hash" text not null, "status" text not null, "movement_id" text null, "rejection_code" text null, "rejection_message" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "manufacturing_operations" add constraint "manufacturing_operations_operation_id_unique" unique ("tenant_id", "organization_id", "operation_id");`);
    this.addSql(`create unique index "manufacturing_operations_unresolved_unique" on "manufacturing_operations" ("tenant_id", "organization_id", "order_id", "action") where "status" in ('in_progress', 'unknown');`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "manufacturing_operations" cascade;`);
  }

}
