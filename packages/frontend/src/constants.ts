// Die Beschriftungen liegen in @poi-app/shared, weil auch das Backend sie
// braucht: die CSV-Datei gab den Status vorher als Rohwert `open` aus, während
// die Tabelle daneben „Offen" zeigte. Hier nur noch weitergereicht, damit die
// bestehenden Importe unverändert bleiben.
export { PRIORITY_LABELS, STATUS_LABELS } from '@poi-app/shared'

import { STATUS_LABELS } from '@poi-app/shared'

export const STATUS_VALUES = Object.keys(STATUS_LABELS)
