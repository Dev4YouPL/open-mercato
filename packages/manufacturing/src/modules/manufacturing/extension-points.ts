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
    workCentersTable: dataTableExtensionHost({
      tableId: 'manufacturing.work_center',
      baseSpotId: 'data-table:manufacturing.work_center',
      source: 'components/WorkCentersTableClient.tsx',
    }),
    workCenterForm: crudFormExtensionHost({
      entityId: 'manufacturing.work_center',
      spotId: 'crud-form:manufacturing.work_center',
      source: 'components/WorkCenterFormClient.tsx',
    }),
    bomLineForm: crudFormExtensionHost({
      entityId: 'manufacturing.bom_line',
      spotId: 'crud-form:manufacturing.bom_line',
      source: 'components/BomLineDialog.tsx',
    }),
  },
})

export default extensionPoints
