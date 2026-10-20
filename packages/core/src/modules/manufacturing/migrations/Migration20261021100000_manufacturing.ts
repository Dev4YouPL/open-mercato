import { Migration } from '@mikro-orm/migrations';

export class Migration20261021100000_manufacturing extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "manufacturing_operations" add column "document_type" text null, add column "planned_facts" jsonb null;`);

    this.addSql(`alter table "manufacturing_production_facts" alter column "warehouse_id" drop not null, alter column "location_id" drop not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "manufacturing_production_facts" alter column "warehouse_id" set not null, alter column "location_id" set not null;`);

    this.addSql(`alter table "manufacturing_operations" drop column "document_type", drop column "planned_facts";`);
  }

}
