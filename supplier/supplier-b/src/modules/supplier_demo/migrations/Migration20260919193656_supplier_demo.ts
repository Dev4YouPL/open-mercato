import { Migration } from '@mikro-orm/migrations';

export class Migration20260919193656_supplier_demo extends Migration {

  override name = 'Migration20260919193656';

  override up(): void | Promise<void> {
    this.addSql(`alter table "supplier_demo_supply_messages" add "interpretation_record" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "supplier_demo_supply_messages" drop column "interpretation_record";`);
  }

}
