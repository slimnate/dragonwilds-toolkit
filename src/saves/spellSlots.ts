export const RADIAL_COUNT = 4
export const SLOTS_PER_RADIAL = 12
export const SPELL_SLOT_COUNT = RADIAL_COUNT * SLOTS_PER_RADIAL
export const RADIAL_LABELS = ['I', 'II', 'III', 'IV']

export type SpellDragPayload = {
  id: string
  fromIndex: number | null
}
