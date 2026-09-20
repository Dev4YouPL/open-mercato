import { Migration } from '@mikro-orm/migrations';

export class Migration20260918193752_supplier_demo extends Migration {

  override name = 'Migration20260918193752';

  override up(): void | Promise<void> {
    this.addSql(`create table "supplier_demo_production_slots" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "catalog_variant_id" uuid not null, "starts_at" timestamptz not null, "capacity_quantity" int not null, "allocations" jsonb not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "supplier_demo_production_slots_variant_date_uq" on "supplier_demo_production_slots" ("tenant_id", "organization_id", "catalog_variant_id", "starts_at") where "deleted_at" is null;`);
    this.addSql(`create index "supplier_demo_production_slots_scope_variant_idx" on "supplier_demo_production_slots" ("tenant_id", "organization_id", "catalog_variant_id", "starts_at");`);

    this.addSql(`create table "supplier_demo_supply_cases" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "correlation_id" text not null, "sales_order_id" uuid not null, "order_number" text not null, "customer_entity_id" uuid null, "customer_snapshot" jsonb null, "customer_display_name" text null, "recipient_email" text null, "catalog_variant_id" uuid not null, "sku" text not null, "trigger" text not null default 'wms_shortfall', "status" text not null default 'detected', "status_reason" text null, "original_commitment" jsonb not null, "baseline_commitment" jsonb not null, "current_commitment" jsonb not null, "plan_summary" jsonb null, "risk_level" text null, "policy_decision" text null, "currency_code" text not null default 'PLN', "additional_cost" numeric(12,2) null, "negotiation_turn" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "supplier_demo_supply_cases_correlation_uq" on "supplier_demo_supply_cases" ("tenant_id", "organization_id", "correlation_id") where "deleted_at" is null;`);
    this.addSql(`create unique index "supplier_demo_supply_cases_order_uq" on "supplier_demo_supply_cases" ("tenant_id", "organization_id", "sales_order_id") where "deleted_at" is null;`);
    this.addSql(`create index "supplier_demo_supply_cases_scope_status_idx" on "supplier_demo_supply_cases" ("tenant_id", "organization_id", "status");`);

    this.addSql(`create table "supplier_demo_supply_messages" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "supply_case_id" uuid not null, "business_message_id" text not null, "direction" text not null default 'outbound', "message_type" text not null default 'SUPPLY_PROPOSAL', "sender_email" text null, "recipient_email" text null, "subject" text not null, "envelope_payload" jsonb not null, "delivery_status" text not null default 'pending', "comm_message_id" uuid null, "comm_thread_id" uuid null, "comm_channel_id" uuid null, "last_error" text null, "attempts" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "supplier_demo_supply_messages_business_id_uq" on "supplier_demo_supply_messages" ("tenant_id", "organization_id", "business_message_id") where "deleted_at" is null;`);
    this.addSql(`create index "supplier_demo_supply_messages_comm_message_idx" on "supplier_demo_supply_messages" ("tenant_id", "organization_id", "comm_message_id");`);
    this.addSql(`create index "supplier_demo_supply_messages_case_idx" on "supplier_demo_supply_messages" ("tenant_id", "organization_id", "supply_case_id");`);
  }

}
