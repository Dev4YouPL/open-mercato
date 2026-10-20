import { Migration } from '@mikro-orm/migrations';

export class Migration20261020150000_manufacturing extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "manufacturing_operations" add column "requested_by" uuid not null, add column "movement_kind" text null, add column "variant_id" uuid null, add column "warehouse_id" uuid null, add column "location_id" uuid null, add column "quantity" numeric(18,4) null;`);

    this.addSql(`create table "manufacturing_execution_documents" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "document_type" text not null, "order_id" uuid not null, "operation_id" uuid not null, "posted_by" uuid not null, "posted_at" timestamptz not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "manufacturing_execution_documents_order_idx" on "manufacturing_execution_documents" ("tenant_id", "organization_id", "order_id", "posted_at");`);
    this.addSql(`alter table "manufacturing_execution_documents" add constraint "manufacturing_execution_documents_operation_unique" unique ("tenant_id", "organization_id", "operation_id");`);

    this.addSql(`create table "manufacturing_production_facts" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "document_id" uuid not null, "fact_kind" text not null, "variant_id" uuid not null, "warehouse_id" uuid not null, "location_id" uuid not null, "quantity" numeric(18,4) not null, "movement_id" text null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "manufacturing_production_facts_document_idx" on "manufacturing_production_facts" ("document_id");`);

    this.addSql(`alter table "manufacturing_production_facts" add constraint "manufacturing_production_facts_document_id_foreign" foreign key ("document_id") references "manufacturing_execution_documents" ("id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "manufacturing_production_facts" drop constraint if exists "manufacturing_production_facts_document_id_foreign";`);

    this.addSql(`drop table if exists "manufacturing_production_facts" cascade;`);
    this.addSql(`drop table if exists "manufacturing_execution_documents" cascade;`);

    this.addSql(`alter table "manufacturing_operations" drop column "requested_by", drop column "movement_kind", drop column "variant_id", drop column "warehouse_id", drop column "location_id", drop column "quantity";`);
  }

}
