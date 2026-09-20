import { Migration } from '@mikro-orm/migrations';

export class Migration20260919023339_supplier_demo extends Migration {

  override name = 'Migration20260919023339';

  override up(): void | Promise<void> {
    this.addSql(`alter table "supplier_demo_supply_cases" add "accepted_commitment" jsonb null, add "cancelled_commitment" jsonb null, add "freed_capacity" jsonb null, add "reply_received_at" timestamptz null, add "commitment_updated_at" timestamptz null, add "resolved_at" timestamptz null;`);

    this.addSql(`alter table "supplier_demo_supply_messages" add "validation_status" text null, add "validation_reason" text null, add "envelope_message_id" text null, add "hub_channel_link_id" uuid null, add "hub_external_message_id" uuid null, add "hub_message_id" uuid null, add "rfc_message_id" text null, add "in_reply_to_business_id" text null, add "received_at" timestamptz null, add "queued_at" timestamptz null, add "delivered_at" timestamptz null, add "applied_at" timestamptz null, add "duplicate_count" int not null default 0, add "body_excerpt" text null;`);
    this.addSql(`alter table "supplier_demo_supply_messages" alter column "message_type" drop not null;`);
    this.addSql(`create unique index "supplier_demo_supply_messages_hub_link_uq" on "supplier_demo_supply_messages" ("tenant_id", "organization_id", "hub_channel_link_id") where "hub_channel_link_id" is not null and "deleted_at" is null;`);
    this.addSql(`create index "supplier_demo_supply_messages_case_direction_idx" on "supplier_demo_supply_messages" ("tenant_id", "organization_id", "supply_case_id", "direction");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "supplier_demo_supply_cases" drop column "accepted_commitment", drop column "cancelled_commitment", drop column "freed_capacity", drop column "reply_received_at", drop column "commitment_updated_at", drop column "resolved_at";`);

    this.addSql(`drop index "supplier_demo_supply_messages_hub_link_uq";`);
    this.addSql(`drop index "supplier_demo_supply_messages_case_direction_idx";`);
    this.addSql(`alter table "supplier_demo_supply_messages" drop column "validation_status", drop column "validation_reason", drop column "envelope_message_id", drop column "hub_channel_link_id", drop column "hub_external_message_id", drop column "hub_message_id", drop column "rfc_message_id", drop column "in_reply_to_business_id", drop column "received_at", drop column "queued_at", drop column "delivered_at", drop column "applied_at", drop column "duplicate_count", drop column "body_excerpt";`);
    this.addSql(`alter table "supplier_demo_supply_messages" alter column "message_type" set not null;`);
  }

}
