import { Migration } from '@mikro-orm/migrations';

export class Migration20260905150718_manufacturing extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "manufacturing_work_centers" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "code" text not null, "name" text not null, "description" text null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "manufacturing_work_centers_list_idx" on "manufacturing_work_centers" ("tenant_id", "organization_id", "code", "id") where "deleted_at" is null;`);
    this.addSql(`create unique index "manufacturing_work_centers_code_unique_idx" on "manufacturing_work_centers" ("tenant_id", "organization_id", lower("code")) where "deleted_at" is null;`);
    this.addSql(`create unique index "manufacturing_work_centers_scope_unique_idx" on "manufacturing_work_centers" ("id", "tenant_id", "organization_id");`);
    this.addSql(`create index "manufacturing_work_centers_scope_idx" on "manufacturing_work_centers" ("tenant_id", "organization_id");`);

    this.addSql(`create table "manufacturing_work_center_resources" ("id" uuid not null default gen_random_uuid(), "work_center_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "resource_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create unique index "manufacturing_work_center_resources_unique_idx" on "manufacturing_work_center_resources" ("tenant_id", "organization_id", "work_center_id", "resource_id");`);

    this.addSql(`alter table "manufacturing_work_centers" add constraint "manufacturing_work_centers_description_len_chk" check ("description" is null or char_length("description") <= 8000);`);
    this.addSql(`alter table "manufacturing_work_centers" add constraint "manufacturing_work_centers_name_len_chk" check (char_length("name") between 1 and 200);`);
    this.addSql(`alter table "manufacturing_work_centers" add constraint "manufacturing_work_centers_code_len_chk" check (char_length("code") between 1 and 100);`);

    this.addSql(`alter table "manufacturing_work_center_resources" add constraint "manufacturing_work_center_resources_work_center_id_foreign" foreign key ("work_center_id") references "manufacturing_work_centers" ("id") on delete restrict;`);

    // Composite scope FK — defense-in-depth against a cross-tenant/organization
    // reference bug, matching the BOM aggregate: a membership row must reference
    // a parent living in the exact same tenant+organization, not merely a parent
    // that exists. Backed by "manufacturing_work_centers_scope_unique_idx".
    // There is deliberately no foreign key to the resources module: `resource_id`
    // is a scalar reference, and disabling or deleting a resource must never
    // cascade into Work Centre history.
    this.addSql(`alter table "manufacturing_work_center_resources" add constraint "manufacturing_work_center_resources_scope_foreign" foreign key ("work_center_id", "tenant_id", "organization_id") references "manufacturing_work_centers" ("id", "tenant_id", "organization_id") on delete restrict;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "manufacturing_work_center_resources" drop constraint if exists "manufacturing_work_center_resources_scope_foreign";`);
    this.addSql(`alter table "manufacturing_work_center_resources" drop constraint if exists "manufacturing_work_center_resources_work_center_id_foreign";`);

    this.addSql(`drop table if exists "manufacturing_work_center_resources" cascade;`);
    this.addSql(`drop table if exists "manufacturing_work_centers" cascade;`);
  }

}
