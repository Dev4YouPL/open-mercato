import { Migration } from '@mikro-orm/migrations'
import { declareQueryIndexReindex } from '@open-mercato/shared/lib/query/migration-reindex'

export const queryIndexReindexEntityTypes = declareQueryIndexReindex([
  'manufacturing:manufacturing_bom',
])

export class Migration20261008132818_manufacturing extends Migration {
  override name = 'Migration20261008132818'

  override up(): void | Promise<void> {
    this.addSql(`
      alter table "manufacturing_boms"
        add column "is_incomplete" boolean not null default false,
        add column "released_at" timestamptz null,
        add column "released_by_user_id" uuid null;
    `)

    this.addSql(`
      with ranked as (
        select
          "id",
          row_number() over (
            partition by
              "tenant_id",
              "organization_id",
              "output_variant_id"
            order by "created_at", "id"
          ) as next_revision
        from "manufacturing_boms"
      )
      update "manufacturing_boms" as bom
      set "revision" = ranked.next_revision::text
      from ranked
      where bom."id" = ranked."id";
    `)

    this.addSql(`
      alter table "manufacturing_boms"
        add constraint "manufacturing_boms_variant_revision_unique"
        unique (
          "tenant_id",
          "organization_id",
          "output_variant_id",
          "revision"
        );
    `)
  }

  override down(): void | Promise<void> {
    this.addSql(`
      alter table "manufacturing_boms"
        drop constraint if exists "manufacturing_boms_variant_revision_unique";
    `)

    this.addSql(`
      alter table "manufacturing_boms"
        drop column "is_incomplete",
        drop column "released_at",
        drop column "released_by_user_id";
    `)
  }
}