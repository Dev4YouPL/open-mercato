import { Migration } from '@mikro-orm/migrations';

export class Migration20260919121432_supplier_demo extends Migration {

  override name = 'Migration20260919121432';

  override up(): void | Promise<void> {
    this.addSql(`alter table "supplier_demo_supply_messages" add "negotiation_record" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "supplier_demo_supply_messages" drop column "negotiation_record";`);
  }

}
