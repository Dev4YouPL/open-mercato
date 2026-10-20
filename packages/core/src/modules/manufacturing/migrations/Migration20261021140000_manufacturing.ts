import { Migration } from '@mikro-orm/migrations';

export class Migration20261021140000_manufacturing extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "manufacturing_production_orders" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "order_number" text not null, "product_variant_id" uuid not null, "bom_revision_id" uuid not null, "planned_quantity" numeric(18,4) not null, "source_location_id" uuid not null, "target_location_id" uuid not null, "due_at" timestamptz null, "status" text not null default 'draft', "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "manufacturing_production_orders_variant_idx" on "manufacturing_production_orders" ("tenant_id", "organization_id", "product_variant_id");`);
    this.addSql(`create index "manufacturing_production_orders_status_idx" on "manufacturing_production_orders" ("tenant_id", "organization_id", "status");`);
    this.addSql(`alter table "manufacturing_production_orders" add constraint "manufacturing_production_orders_number_unique" unique ("tenant_id", "organization_id", "order_number");`);

    this.addSql(`create table "manufacturing_order_sequences" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "next_number" int not null default 1, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "manufacturing_order_sequences" add constraint "manufacturing_order_sequences_scope_unique" unique ("tenant_id", "organization_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "manufacturing_order_sequences" cascade;`);
    this.addSql(`drop table if exists "manufacturing_production_orders" cascade;`);
  }

}
