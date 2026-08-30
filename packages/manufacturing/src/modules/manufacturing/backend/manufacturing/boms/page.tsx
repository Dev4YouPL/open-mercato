import { BomListClient } from "../../../components/BomListClient"
import { extensionPoints } from "../../../extension-points"

export default function ManufacturingBomsListPage() {
  return <BomListClient extensionTableId={extensionPoints.hosts.bomsTable.tableId} />
}
