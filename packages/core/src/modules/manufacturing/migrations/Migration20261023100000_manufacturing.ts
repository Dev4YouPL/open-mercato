import { Migration } from '@mikro-orm/migrations';

export class Migration20261023100000_manufacturing extends Migration {

  override name = 'Migration20261023100000';

  override up(): void | Promise<void> {
    this.addSql(`create index "manufacturing_production_orders_bom_revision_idx" on "manufacturing_production_orders" ("tenant_id", "organization_id", "bom_revision_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "manufacturing_production_orders_bom_revision_idx";`);
  }

}
