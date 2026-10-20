import { Migration } from '@mikro-orm/migrations';

export class Migration20261020180000_manufacturing extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "manufacturing_operations" add column "source_document_id" uuid null;`);

    this.addSql(`alter table "manufacturing_execution_documents" add column "reverses_document_id" uuid null;`);
    this.addSql(`create unique index "manufacturing_execution_documents_reversal_unique" on "manufacturing_execution_documents" ("tenant_id", "organization_id", "reverses_document_id") where "reverses_document_id" is not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "manufacturing_execution_documents_reversal_unique";`);
    this.addSql(`alter table "manufacturing_execution_documents" drop column "reverses_document_id";`);

    this.addSql(`alter table "manufacturing_operations" drop column "source_document_id";`);
  }

}
