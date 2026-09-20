import { Migration } from '@mikro-orm/migrations';

export class Migration20260920072817_supplier_demo extends Migration {

  override name = 'Migration20260920072817';

  override up(): void | Promise<void> {
    this.addSql(`create table "supplier_demo_rfqs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "correlation_id" text not null, "subject" text not null, "sender_email" text not null, "recipient_email" text null, "rfc_message_id" text null, "thread_id" uuid null, "channel_link_id" uuid null, "channel_id" uuid null, "body_format" text not null default 'text', "raw_body" text not null, "sku" text not null, "requested_quantity" int null, "requested_delivery_date" text null, "interpretation_status" text not null default 'pending', "interpretation_record" jsonb null, "availability_snapshot" jsonb null, "price_snapshot" jsonb null, "computed_offer" jsonb null, "status" text not null default 'pending_interpretation', "operator_decision" text not null default 'pending', "send_status" text not null default 'not_sent', "reply_subject" text null, "reply_body" text null, "last_error" text null, "history" jsonb not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "supplier_demo_rfqs_rfc_message_uq" on "supplier_demo_rfqs" ("tenant_id", "organization_id", "rfc_message_id") where "rfc_message_id" is not null and "deleted_at" is null;`);
    this.addSql(`create unique index "supplier_demo_rfqs_channel_link_uq" on "supplier_demo_rfqs" ("tenant_id", "organization_id", "channel_link_id") where "channel_link_id" is not null and "deleted_at" is null;`);
    this.addSql(`create index "supplier_demo_rfqs_scope_correlation_idx" on "supplier_demo_rfqs" ("tenant_id", "organization_id", "correlation_id");`);
    this.addSql(`create index "supplier_demo_rfqs_scope_status_idx" on "supplier_demo_rfqs" ("tenant_id", "organization_id", "status", "updated_at");`);
  }

}
