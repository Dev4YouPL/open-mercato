import {
  crudFormExtensionHost,
  dataTableExtensionHost,
  defineModuleExtensionPoints,
} from '@open-mercato/shared/modules/widgets/extension-points'

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'manufacturing',
  hosts: {
    bomsTable: dataTableExtensionHost({
      tableId: 'manufacturing.bom',
      baseSpotId: 'data-table:manufacturing.bom',
      source: 'backend/manufacturing/boms/page.tsx',
    }),
    bomHeaderForm: crudFormExtensionHost({
      entityId: 'manufacturing.bom',
      spotId: 'crud-form:manufacturing.bom',
      source: 'components/BomHeaderFormClient.tsx',
    }),
    bomLinesTable: dataTableExtensionHost({
      tableId: 'manufacturing.bom_line',
      baseSpotId: 'data-table:manufacturing.bom_line',
      source: 'components/BomLinesEditor.tsx',
    }),
    bomLineForm: crudFormExtensionHost({
      entityId: 'manufacturing.bom_line',
      spotId: 'crud-form:manufacturing.bom_line',
      source: 'components/BomLineDialog.tsx',
    }),
  },
})

export default extensionPoints
