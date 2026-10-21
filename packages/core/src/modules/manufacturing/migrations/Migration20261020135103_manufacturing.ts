import { Migration } from '@mikro-orm/migrations';

export class Migration20261020135103_manufacturing extends Migration {

  override name = 'Migration20261020135103';

  override up(): void | Promise<void> {
    this.addSql(`alter table "manufacturing_boms" add "is_available_for_new_orders" boolean not null default true;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "manufacturing_boms" drop column "is_available_for_new_orders";`);
  }

}
