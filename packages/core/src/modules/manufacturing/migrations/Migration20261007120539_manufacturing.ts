import { Migration } from '@mikro-orm/migrations';

export class Migration20261007120539_manufacturing extends Migration {

  override name = 'Migration20261007120539';

  override up(): void | Promise<void> {
    this.addSql(`create table "manufacturing_boms" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "output_variant_id" uuid not null, "base_quantity" numeric(16,6) not null, "revision" text not null, "status" text not null default 'draft', "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "manufacturing_boms_org_tenant_idx" on "manufacturing_boms" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "manufacturing_boms" add constraint "manufacturing_boms_base_quantity_positive_chk" check ("base_quantity" > 0);`);

    this.addSql(`create table "manufacturing_bom_items" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "bom_id" uuid not null, "component_variant_id" uuid not null, "quantity" numeric(18,6) not null, "position" int not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "manufacturing_bom_items_bom_idx" on "manufacturing_bom_items" ("bom_id");`);
    this.addSql(`create index "manufacturing_bom_items_org_tenant_idx" on "manufacturing_bom_items" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "manufacturing_bom_items" add constraint "manufacturing_bom_items_quantity_positive_chk" check ("quantity" > 0);`);

    this.addSql(`alter table "manufacturing_bom_items" add constraint "manufacturing_bom_items_bom_id_foreign" foreign key ("bom_id") references "manufacturing_boms" ("id");`);
  }

}
