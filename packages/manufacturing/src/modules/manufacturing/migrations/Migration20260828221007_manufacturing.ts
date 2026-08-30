import { Migration } from '@mikro-orm/migrations';

export class Migration20260828221007_manufacturing extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "manufacturing_boms" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "product_id" uuid not null, "variant_id" uuid null, "next_revision_number" int not null default 2, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "manufacturing_boms_resolution_idx" on "manufacturing_boms" ("tenant_id", "organization_id", "product_id", "variant_id") where "deleted_at" is null;`);
    this.addSql(`create index "manufacturing_boms_product_keyset_idx" on "manufacturing_boms" ("tenant_id", "organization_id", "product_id", "updated_at" desc, "id" desc) where "deleted_at" is null;`);
    this.addSql(`create index "manufacturing_boms_keyset_idx" on "manufacturing_boms" ("tenant_id", "organization_id", "updated_at" desc, "id" desc) where "deleted_at" is null;`);
    this.addSql(`create unique index "manufacturing_boms_variant_target_unique_idx" on "manufacturing_boms" ("tenant_id", "organization_id", "product_id", "variant_id") where "deleted_at" is null and "variant_id" is not null;`);
    this.addSql(`create unique index "manufacturing_boms_product_target_unique_idx" on "manufacturing_boms" ("tenant_id", "organization_id", "product_id") where "deleted_at" is null and "variant_id" is null;`);
    this.addSql(`create unique index "manufacturing_boms_scope_unique_idx" on "manufacturing_boms" ("id", "tenant_id", "organization_id");`);
    this.addSql(`create index "manufacturing_boms_org_tenant_idx" on "manufacturing_boms" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "manufacturing_boms" add constraint "manufacturing_boms_next_revision_chk" check ("next_revision_number" >= 2);`);

    this.addSql(`create table "manufacturing_bom_revisions" ("id" uuid not null default gen_random_uuid(), "bom_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "revision_number" int not null, "revision_label" text null, "status" text not null default 'draft', "base_output_entered_quantity" numeric(18,6) not null, "base_output_entered_unit_code" text not null, "base_output_normalized_quantity" numeric(18,6) not null, "base_output_normalized_unit_code" text not null, "base_output_uom_snapshot" jsonb not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "manufacturing_bom_revisions_scope_lookup_idx" on "manufacturing_bom_revisions" ("tenant_id", "organization_id", "bom_id", "status") where "deleted_at" is null;`);
    this.addSql(`create unique index "manufacturing_bom_revisions_active_draft_unique_idx" on "manufacturing_bom_revisions" ("bom_id") where "deleted_at" is null and "status" = 'draft';`);
    this.addSql(`create unique index "manufacturing_bom_revisions_number_unique_idx" on "manufacturing_bom_revisions" ("bom_id", "revision_number");`);
    this.addSql(`create unique index "manufacturing_bom_revisions_scope_unique_idx" on "manufacturing_bom_revisions" ("id", "tenant_id", "organization_id");`);
    this.addSql(`alter table "manufacturing_bom_revisions" add constraint "manufacturing_bom_revisions_snapshot_consistency_chk" check ("base_output_entered_quantity" = ("base_output_uom_snapshot"->>'enteredQuantity')::numeric and "base_output_normalized_quantity" = ("base_output_uom_snapshot"->>'normalizedQuantity')::numeric and "base_output_entered_unit_code" = "base_output_uom_snapshot"->>'enteredUnitCode' and "base_output_normalized_unit_code" = "base_output_uom_snapshot"->>'baseUnitCode');`);
    this.addSql(`alter table "manufacturing_bom_revisions" add constraint "manufacturing_bom_revisions_snapshot_version_chk" check (("base_output_uom_snapshot"->>'version')::int = 1);`);
    this.addSql(`alter table "manufacturing_bom_revisions" add constraint "manufacturing_bom_revisions_base_output_positive_chk" check ("base_output_entered_quantity" > 0 and "base_output_normalized_quantity" > 0);`);
    this.addSql(`alter table "manufacturing_bom_revisions" add constraint "manufacturing_bom_revisions_label_len_chk" check (char_length("revision_label") <= 120);`);
    this.addSql(`alter table "manufacturing_bom_revisions" add constraint "manufacturing_bom_revisions_number_chk" check ("revision_number" > 0);`);
    this.addSql(`alter table "manufacturing_bom_revisions" add constraint "manufacturing_bom_revisions_status_chk" check ("status" = 'draft');`);

    this.addSql(`create table "manufacturing_bom_lines" ("id" uuid not null default gen_random_uuid(), "revision_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "component_product_id" uuid not null, "component_variant_id" uuid null, "entered_quantity" numeric(18,6) not null, "entered_unit_code" text not null, "normalized_quantity" numeric(18,6) not null, "normalized_unit_code" text not null, "uom_snapshot" jsonb not null, "consumption_basis" text not null default 'variable', "yield_factor" numeric(18,12) not null default '1', "supply_mode" text not null default 'stock', "position" bigint not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "manufacturing_bom_lines_unresolved_idx" on "manufacturing_bom_lines" ("tenant_id", "organization_id", "revision_id") where "deleted_at" is null and "supply_mode" = 'produce';`);
    this.addSql(`create index "manufacturing_bom_lines_graph_lookup_idx" on "manufacturing_bom_lines" ("tenant_id", "organization_id", "component_product_id", "component_variant_id") where "deleted_at" is null and "supply_mode" = 'produce';`);
    this.addSql(`create index "manufacturing_bom_lines_ordered_read_idx" on "manufacturing_bom_lines" ("tenant_id", "organization_id", "revision_id", "position", "id") where "deleted_at" is null;`);
    this.addSql(`create unique index "manufacturing_bom_lines_position_unique_idx" on "manufacturing_bom_lines" ("revision_id", "position") where "deleted_at" is null;`);
    this.addSql(`alter table "manufacturing_bom_lines" add constraint "manufacturing_bom_lines_snapshot_consistency_chk" check ("entered_quantity" = ("uom_snapshot"->>'enteredQuantity')::numeric and "normalized_quantity" = ("uom_snapshot"->>'normalizedQuantity')::numeric and "entered_unit_code" = "uom_snapshot"->>'enteredUnitCode' and "normalized_unit_code" = "uom_snapshot"->>'baseUnitCode');`);
    this.addSql(`alter table "manufacturing_bom_lines" add constraint "manufacturing_bom_lines_snapshot_version_chk" check (("uom_snapshot"->>'version')::int = 1);`);
    this.addSql(`alter table "manufacturing_bom_lines" add constraint "manufacturing_bom_lines_position_range_chk" check ("position" > 0 and "position" <= 9007199254740991);`);
    this.addSql(`alter table "manufacturing_bom_lines" add constraint "manufacturing_bom_lines_quantity_positive_chk" check ("entered_quantity" > 0 and "normalized_quantity" > 0);`);
    this.addSql(`alter table "manufacturing_bom_lines" add constraint "manufacturing_bom_lines_yield_chk" check ("yield_factor" > 0 and "yield_factor" <= 1);`);
    this.addSql(`alter table "manufacturing_bom_lines" add constraint "manufacturing_bom_lines_supply_chk" check ("supply_mode" in ('stock', 'produce'));`);
    this.addSql(`alter table "manufacturing_bom_lines" add constraint "manufacturing_bom_lines_basis_chk" check ("consumption_basis" in ('variable', 'fixed'));`);

    this.addSql(`alter table "manufacturing_bom_revisions" add constraint "manufacturing_bom_revisions_bom_id_foreign" foreign key ("bom_id") references "manufacturing_boms" ("id") on delete restrict;`);

    this.addSql(`alter table "manufacturing_bom_lines" add constraint "manufacturing_bom_lines_revision_id_foreign" foreign key ("revision_id") references "manufacturing_bom_revisions" ("id") on delete restrict;`);

    // Composite scope FKs — defense-in-depth against a cross-tenant/organization
    // reference bug: the row must reference a parent that lives in the exact same
    // tenant+organization, not merely a parent that exists.
    this.addSql(`alter table "manufacturing_bom_revisions" add constraint "manufacturing_bom_revisions_bom_scope_foreign" foreign key ("bom_id", "tenant_id", "organization_id") references "manufacturing_boms" ("id", "tenant_id", "organization_id") on delete restrict;`);
    this.addSql(`alter table "manufacturing_bom_lines" add constraint "manufacturing_bom_lines_revision_scope_foreign" foreign key ("revision_id", "tenant_id", "organization_id") references "manufacturing_bom_revisions" ("id", "tenant_id", "organization_id") on delete restrict;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "manufacturing_bom_lines" drop constraint if exists "manufacturing_bom_lines_revision_scope_foreign";`);
    this.addSql(`alter table "manufacturing_bom_revisions" drop constraint if exists "manufacturing_bom_revisions_bom_scope_foreign";`);
    this.addSql(`alter table "manufacturing_bom_lines" drop constraint if exists "manufacturing_bom_lines_revision_id_foreign";`);
    this.addSql(`alter table "manufacturing_bom_revisions" drop constraint if exists "manufacturing_bom_revisions_bom_id_foreign";`);

    this.addSql(`drop table if exists "manufacturing_bom_lines" cascade;`);
    this.addSql(`drop table if exists "manufacturing_bom_revisions" cascade;`);
    this.addSql(`drop table if exists "manufacturing_boms" cascade;`);
  }

}
