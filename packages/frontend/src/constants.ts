export const STATUS_LABELS: Record<string, string> = {
  open: 'Offen',
  in_bearbeitung: 'In Bearbeitung',
  geprueft: 'Geprüft',
  erledigt: 'Erledigt',
  abgeschlossen: 'Abgeschlossen',
}

export const STATUS_VALUES = Object.keys(STATUS_LABELS)

export const PRIORITY_LABELS: Record<string, string> = {
  niedrig: 'Niedrig',
  mittel: 'Mittel',
  hoch: 'Hoch',
}
