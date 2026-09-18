import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CustomFieldDefinition } from '@open-mercato/shared/modules/entities'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { ensureCustomFieldDefinitions } from '@open-mercato/core/modules/entities/lib/field-definitions'
import {
  CustomerAddress,
  CustomerCompanyProfile,
  CustomerTag,
  CustomerTagAssignment,
} from '@open-mercato/core/modules/customers/data/entities'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'

const SUPPLIER_TAG_SLUG = 'dostawca'
const SUPPLIER_FIELD_KEY = 'partner_type'

const supplierField: CustomFieldDefinition = {
  key: SUPPLIER_FIELD_KEY,
  kind: 'select',
  options: [
    { value: 'customer', label: 'Customer' },
    { value: 'supplier', label: 'Supplier' },
    { value: 'both', label: 'Both' },
  ],
  label: 'Typ kontrahenta',
  description: 'Określa, czy firma jest klientem, dostawcą czy obiema rolami.',
  filterable: true,
}

const supplierFieldSets = [
  {
    entity: E.customers.customer_company_profile,
    fields: [supplierField],
  },
]

type SeedScope = {
  tenantId: string
  organizationId: string
}

type CompanySeed = {
  displayName: string
  legalName: string
  brandName: string
  domain: string
  websiteUrl: string
  industry: string
  sizeBucket: string
  description: string
  primaryEmail: string
  primaryPhone: string
  address: {
    addressLine1: string
    city: string
    region: string
    postalCode: string
    country: string
  }
}

const companySeeds: CompanySeed[] = [
  {
    displayName: 'Supplier One',
    legalName: 'Supplier One Sp. z o.o.',
    brandName: 'Supplier One',
    domain: 'supplier-one.example.com',
    websiteUrl: 'https://supplier-one.example.com',
    industry: 'Industrial manufacturing',
    sizeBucket: '51-200',
    description: 'Przykładowy dostawca komponentów przemysłowych.',
    primaryEmail: 'supplier@hackon-om-wro.cloud',
    primaryPhone: '+48 22 555 0101',
    address: {
      addressLine1: 'ul. Przemysłowa 10',
      city: 'Warszawa',
      region: 'Mazowieckie',
      postalCode: '00-001',
      country: 'PL',
    },
  },
  {
    displayName: 'Supplier Two',
    legalName: 'Supplier Two S.A.',
    brandName: 'Supplier Two',
    domain: 'supplier-two.example.com',
    websiteUrl: 'https://supplier-two.example.com',
    industry: 'Packaging',
    sizeBucket: '11-50',
    description: 'Przykładowy dostawca opakowań i materiałów wysyłkowych.',
    primaryEmail: 'supplier2@hackon-om-wro.cloud',
    primaryPhone: '+48 71 555 0202',
    address: {
      addressLine1: 'ul. Logistyczna 24',
      city: 'Wrocław',
      region: 'Dolnośląskie',
      postalCode: '50-001',
      country: 'PL',
    },
  },
]

function buildSystemContext(container: AwilixContainer, scope: SeedScope): CommandRuntimeContext {
  return {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    systemActor: true,
  }
}

async function executeCommand<TResult>(
  container: AwilixContainer,
  scope: SeedScope,
  commandId: string,
  input: Record<string, unknown>,
): Promise<TResult> {
  const commandBus = container.resolve<CommandBus>('commandBus')
  const { result } = await commandBus.execute<Record<string, unknown>, TResult>(commandId, {
    input: { ...input, tenantId: scope.tenantId, organizationId: scope.organizationId },
    ctx: buildSystemContext(container, scope),
  })
  return result
}

async function ensureSupplierField(em: EntityManager, tenantId: string): Promise<void> {
  await ensureCustomFieldDefinitions(em, supplierFieldSets, {
    organizationId: null,
    tenantId,
  })
}

async function ensureSupplierTag(
  em: EntityManager,
  container: AwilixContainer,
  scope: SeedScope,
): Promise<string> {
  const existing = await findOneWithDecryption(
    em,
    CustomerTag,
    {
      slug: SUPPLIER_TAG_SLUG,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    undefined,
    scope,
  )
  if (existing) return existing.id

  const result = await executeCommand<{ tagId: string }>(container, scope, 'customers.tags.create', {
    slug: SUPPLIER_TAG_SLUG,
    label: 'Dostawca',
    color: 'brand',
    description: 'Firma oznaczona jako dostawca.',
  })
  return result.tagId
}

async function ensureSupplierTagAssignment(
  em: EntityManager,
  container: AwilixContainer,
  scope: SeedScope,
  entityId: string,
  tagId: string,
): Promise<void> {
  const existing = await findOneWithDecryption(
    em,
    CustomerTagAssignment,
    {
      tag: tagId,
      entity: entityId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    undefined,
    scope,
  )
  if (existing) return

  await executeCommand(container, scope, 'customers.tags.assign', { tagId, entityId })
}

async function ensureSupplierAddress(
  em: EntityManager,
  container: AwilixContainer,
  scope: SeedScope,
  entityId: string,
  seed: CompanySeed,
): Promise<void> {
  const existing = await findOneWithDecryption(
    em,
    CustomerAddress,
    {
      entity: entityId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      addressLine1: seed.address.addressLine1,
    },
    undefined,
    scope,
  )
  if (existing) return

  await executeCommand(container, scope, 'customers.addresses.create', {
    entityId,
    name: 'Siedziba główna',
    purpose: 'office',
    addressLine1: seed.address.addressLine1,
    city: seed.address.city,
    region: seed.address.region,
    postalCode: seed.address.postalCode,
    country: seed.address.country,
    isPrimary: true,
  })
}

async function ensureSupplierCompany(
  em: EntityManager,
  container: AwilixContainer,
  scope: SeedScope,
  tagId: string,
  seed: CompanySeed,
): Promise<void> {
  const existingCompanies = await findWithDecryption(
    em,
    CustomerCompanyProfile,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    { populate: ['entity'] },
    scope,
  )
  const existing = existingCompanies.find(
    (company) => company.domain === seed.domain && company.entity?.deletedAt == null,
  )

  const entityId = existing?.entity?.id ?? (await executeCommand<{ entityId: string }>(container, scope, 'customers.companies.create', {
    displayName: seed.displayName,
    legalName: seed.legalName,
    brandName: seed.brandName,
    domain: seed.domain,
    websiteUrl: seed.websiteUrl,
    industry: seed.industry,
    sizeBucket: seed.sizeBucket,
    description: seed.description,
    primaryEmail: seed.primaryEmail,
    primaryPhone: seed.primaryPhone,
    status: 'active',
    source: 'seed',
    tags: [tagId],
    [`cf_${SUPPLIER_FIELD_KEY}`]: 'supplier',
  })).entityId

  if (existing) {
    await executeCommand(container, scope, 'customers.companies.update', {
      id: entityId,
      displayName: seed.displayName,
      legalName: seed.legalName,
      brandName: seed.brandName,
      domain: seed.domain,
      websiteUrl: seed.websiteUrl,
      industry: seed.industry,
      sizeBucket: seed.sizeBucket,
      description: seed.description,
      primaryEmail: seed.primaryEmail,
      primaryPhone: seed.primaryPhone,
      status: 'active',
      source: 'seed',
      [`cf_${SUPPLIER_FIELD_KEY}`]: 'supplier',
    })
    await ensureSupplierTagAssignment(em, container, scope, entityId, tagId)
  }

  await ensureSupplierAddress(em, container, scope, entityId, seed)
}

async function ensureExistingCustomerTypes(
  em: EntityManager,
  container: AwilixContainer,
  scope: SeedScope,
): Promise<void> {
  const companies = await findWithDecryption(
    em,
    CustomerCompanyProfile,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    { populate: ['entity'] },
    scope,
  )
  const customerCompanies = companies.filter(
    (company) => company.entity?.deletedAt == null && company.entity?.lifecycleStage === 'customer',
  )
  if (!customerCompanies.length) return

  const customValues = await loadCustomFieldValues({
    em,
    entityId: E.customers.customer_company_profile,
    recordIds: customerCompanies.map((company) => company.id),
    tenantIdByRecord: Object.fromEntries(customerCompanies.map((company) => [company.id, company.tenantId])),
    organizationIdByRecord: Object.fromEntries(customerCompanies.map((company) => [company.id, company.organizationId])),
  })

  for (const company of customerCompanies) {
    if (customValues[company.id]?.[`cf_${SUPPLIER_FIELD_KEY}`] !== undefined) continue
    await executeCommand(container, scope, 'customers.companies.update', {
      id: company.entity!.id,
      [`cf_${SUPPLIER_FIELD_KEY}`]: 'customer',
    })
  }
}

export async function seedSupplierExamples(
  em: EntityManager,
  container: AwilixContainer,
  scope: SeedScope,
): Promise<void> {
  const tagId = await ensureSupplierTag(em, container, scope)
  for (const seed of companySeeds) {
    await ensureSupplierCompany(em, container, scope, tagId, seed)
  }
  await ensureExistingCustomerTypes(em, container, scope)
}

export const setup: ModuleSetupConfig = {
  async seedDefaults({ em, container, tenantId, organizationId }) {
    await ensureSupplierField(em, tenantId)
    await seedSupplierExamples(em, container, { tenantId, organizationId })
  },
}

export default setup
