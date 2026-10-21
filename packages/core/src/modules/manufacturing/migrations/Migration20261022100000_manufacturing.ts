import { Migration } from '@mikro-orm/migrations';

export class Migration20261022100000_manufacturing extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "manufacturing_executions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "execution_number" text not null, "order_id" uuid null, "product_variant_id" uuid null, "source_location_id" uuid null, "target_location_id" uuid null, "created_by" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "manufacturing_executions_order_idx" on "manufacturing_executions" ("tenant_id", "organization_id", "order_id");`);
    this.addSql(`alter table "manufacturing_executions" add constraint "manufacturing_executions_number_unique" unique ("tenant_id", "organization_id", "execution_number");`);

    this.addSql(`create table "manufacturing_execution_sequences" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "next_number" int not null default 1, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "manufacturing_execution_sequences" add constraint "manufacturing_execution_sequences_scope_unique" unique ("tenant_id", "organization_id");`);

    this.addSql(`drop index if exists "manufacturing_operations_unresolved_unique";`);
    this.addSql(`alter table "manufacturing_operations" rename column "order_id" to "execution_id";`);
    this.addSql(`alter table "manufacturing_operations" add column "order_id" uuid null;`);
    this.addSql(`create unique index "manufacturing_operations_unresolved_unique" on "manufacturing_operations" ("tenant_id", "organization_id", "execution_id", "action") where "status" in ('in_progress', 'unknown');`);

    this.addSql(`alter table "manufacturing_execution_documents" add column "execution_id" uuid not null;`);
    this.addSql(`alter table "manufacturing_execution_documents" alter column "order_id" drop not null;`);
    this.addSql(`create index "manufacturing_execution_documents_execution_idx" on "manufacturing_execution_documents" ("tenant_id", "organization_id", "execution_id", "posted_at");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "manufacturing_execution_documents_execution_idx";`);
    this.addSql(`alter table "manufacturing_execution_documents" alter column "order_id" set not null;`);
    this.addSql(`alter table "manufacturing_execution_documents" drop column "execution_id";`);

    this.addSql(`drop index if exists "manufacturing_operations_unresolved_unique";`);
    this.addSql(`alter table "manufacturing_operations" drop column "order_id";`);
    this.addSql(`alter table "manufacturing_operations" rename column "execution_id" to "order_id";`);
    this.addSql(`create unique index "manufacturing_operations_unresolved_unique" on "manufacturing_operations" ("tenant_id", "organization_id", "order_id", "action") where "status" in ('in_progress', 'unknown');`);

    this.addSql(`drop table if exists "manufacturing_execution_sequences" cascade;`);
    this.addSql(`drop table if exists "manufacturing_executions" cascade;`);
  }

}
