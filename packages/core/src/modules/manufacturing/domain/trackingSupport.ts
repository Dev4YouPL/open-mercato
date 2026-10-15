export type TrackingRequirements = {
  tracksLot: boolean
  tracksSerial: boolean
  tracksExpiry: boolean
}

export function isTrackingSupported(requirements: TrackingRequirements): boolean {
  return !requirements.tracksLot && !requirements.tracksSerial && !requirements.tracksExpiry
}
