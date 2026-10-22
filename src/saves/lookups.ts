/** Consumable loadout slots that point at a bag item (not held gear). */
export type LoadoutPointerKind = 'arrows' | 'runes' | 'bolts' | 'bait'

export const LOADOUT_SLOTS = [
  { index: 0, id: 'Head', label: 'Head', kind: 'item' as const },
  { index: 1, id: 'Body', label: 'Body', kind: 'item' as const },
  { index: 2, id: 'Legs', label: 'Legs', kind: 'item' as const },
  { index: 3, id: 'Cape', label: 'Cape', kind: 'item' as const },
  { index: 4, id: 'Trinket', label: 'Ring', kind: 'item' as const },
  { index: 5, id: 'Ammo', label: 'Ammo', kind: 'hotbar' as const, pointer: 'arrows' as const },
  { index: 6, id: 'MagicAmmo', label: 'Magic ammo', kind: 'hotbar' as const, pointer: 'runes' as const },
  { index: 7, id: 'HeldRight', label: 'Held (right)', kind: 'hotbar' as const },
  { index: 8, id: 'HeldLeft', label: 'Held (left)', kind: 'hotbar' as const },
  { index: 9, id: 'CrossbowBolts', label: 'Crossbow bolts', kind: 'hotbar' as const, pointer: 'bolts' as const },
  { index: 10, id: 'FishingBait', label: 'Fishing bait', kind: 'hotbar' as const, pointer: 'bait' as const },
  { index: 11, id: 'Trinket2', label: 'Amulet', kind: 'item' as const },
]

export type LoadoutSlotMeta = (typeof LOADOUT_SLOTS)[number]

export function loadoutPointerKind(meta: LoadoutSlotMeta | undefined): LoadoutPointerKind | undefined {
  return meta && 'pointer' in meta ? meta.pointer : undefined
}

export const QUEST_STATES = [
  { value: 0, label: 'Ungiven' },
  { value: 1, label: 'Given' },
  { value: 2, label: 'Complete' },
]

export const AGILITY_MEDALS = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Bronze' },
  { value: 2, label: 'Silver' },
  { value: 3, label: 'Gold' },
]

export const STATUS_EFFECTS = [
  { key: 'Cold', hash: 1501092416, icon: 'T_Icon_Sml_Cold.png', color: '#7ec8e8' },
  { key: 'Poison', hash: 1673355410, icon: 'T_Icon_Sml_Poison.png', color: '#7bc45a' },
  { key: 'Burning', hash: 1232270846, icon: 'T_Icon_Sml_Burning.png', color: '#e07030' },
  { key: 'Bleeding', hash: 3836059435, icon: 'T_Icon_Sml_Bleed.png', color: '#c43c3c' },
  { key: 'Slow', hash: 897314269, icon: 'T_Icon_Sml_Water_Wading.png', color: '#9a8fc9' },
  { key: 'WellRested', hash: 2050017224, icon: 'T_Icon_Sml_FreshStart.png', color: '#e0c060' },
  { key: 'Cosiness', hash: 334594781, icon: 'T_Icon_Sml_Coziness.png', color: '#e0a050' },
  { key: 'Wither', hash: 2596365627, icon: 'T_IG_Icon_1.png', color: '#6a8a4a' },
  { key: 'Scorch', hash: 617836362, icon: 'T_S_Icon_2.png', color: '#e89040' },
  { key: 'Chilled', hash: 3700132483, icon: 'T_Icon_Sml_Cold.png', color: '#a0d0f0' },
  { key: 'Shocked', hash: 609174564, icon: 'T_Icon_Sml_Shocked.png', color: '#d4c84a' },
  { key: 'OverEating', hash: 494801183, icon: 'T_Icon_Sml_Overeating.png', color: '#c97a50' },
  { key: 'SoulScourge', hash: 617425600, icon: 'T_Icon_Sml_Soulscourge.png', color: '#8b5cff' },
  { key: 'AnimaCharge', hash: 3131721881, icon: 'T_Air_Icon.png', color: '#c77dff' },
] as const

export const CUSTOMIZATION_TABLES = {
  BodyType: "/Script/Engine.DataTable'/Game/Gameplay/Character/Player/Customization/DT_Customization_BodyType.DT_Customization_BodyType'",
  Head: "/Script/Engine.DataTable'/Game/Gameplay/Character/Player/Customization/DT_Customization_FaceType.DT_Customization_FaceType'",
  HairPreset: "/Script/Engine.DataTable'/Game/Gameplay/Character/Player/Customization/DT_Customization_HairPresets.DT_Customization_HairPresets'",
  FacialHairPreset: "/Script/Engine.DataTable'/Game/Gameplay/Character/Player/Customization/DT_Customization_FacialHairPresets.DT_Customization_FacialHairPresets'",
  SkinTone: "/Script/Engine.DataTable'/Game/Gameplay/Character/Player/Customization/DT_Customization_SkinTone.DT_Customization_SkinTone'",
  HairColor: "/Script/Engine.DataTable'/Game/Gameplay/Character/Player/Customization/DT_Customization_HairColor.DT_Customization_HairColor'",
  EyeColor: "/Script/Engine.DataTable'/Game/Gameplay/Character/Player/Customization/DT_Customization_EyeColor.DT_Customization_EyeColor'",
  EyebrowColor: "/Script/Engine.DataTable'/Game/Gameplay/Character/Player/Customization/DT_Customization_EyebrowColor.DT_Customization_EyebrowColor'",
} as const

export type CustomizationSlot = keyof typeof CUSTOMIZATION_TABLES

export const CUSTOMIZATION_OPTIONS: Record<CustomizationSlot, string[]> = {
  BodyType: ['male_A_01', 'male_B_01', 'male_C_01', 'male_D_01', 'female_A_01', 'female_B_01', 'female_C_01', 'female_D_01'],
  Head: [
    'male_A_01', 'male_A_02', 'male_A_03',
    'male_B_01', 'male_B_02', 'male_B_03',
    'male_C_01', 'male_C_02', 'male_C_03',
    'male_D_01', 'male_D_02', 'male_D_03',
    'female_A_01', 'female_B_01', 'female_C_01', 'female_D_01',
  ],
  HairPreset: Array.from({ length: 30 }, (_, i) => `Preset${i + 1}`),
  FacialHairPreset: [
    'None',
    'M_A_Preset1', 'M_A_Preset2', 'M_B_Preset1', 'M_C_Preset1', 'M_D_Preset1',
  ],
  SkinTone: Array.from({ length: 10 }, (_, i) => `SkinTone${i + 1}`),
  HairColor: Array.from({ length: 12 }, (_, i) => `Color${i + 1}`),
  EyeColor: Array.from({ length: 12 }, (_, i) => `Color${i + 1}`),
  EyebrowColor: Array.from({ length: 12 }, (_, i) => `Color${i + 1}`),
}

export type MountInfo = {
  id: string
  name: string
  icon: string
  group: 'Terror Birds' | 'Magic Carpets'
}

/** In-game DisplayName + MountIcon from DA_Mount_* / ST_MountVariants. */
export const MOUNTS: MountInfo[] = [
  { id: 'MountDataAsset:DA_Mount_Terrorbird_00_00', name: 'Terrorbird Mount', icon: 'T_Mount_Terrobird_01_00.png', group: 'Terror Birds' },
  { id: 'MountDataAsset:DA_Mount_Terrorbird_01_05', name: 'Oakfeather Raptor', icon: 'T_Mount_Terrobird_01_05.png', group: 'Terror Birds' },
  { id: 'MountDataAsset:DA_Mount_Terrorbird_01_04', name: 'Leafwood Strider', icon: 'T_Mount_Terrobird_01_04.png', group: 'Terror Birds' },
  { id: 'MountDataAsset:DA_Mount_Terrorbird_01_03', name: 'Grassfoot Screecher', icon: 'T_Mount_Terrobird_01_03.png', group: 'Terror Birds' },
  { id: 'MountDataAsset:DA_Mount_Terrorbird_01_02', name: 'Springdown Runner', icon: 'T_Mount_Terrobird_01_02.png', group: 'Terror Birds' },
  { id: 'MountDataAsset:DA_Mount_Terrorbird_01_01', name: 'Mossbreak Hunter', icon: 'T_Mount_Terrobird_01_01.png', group: 'Terror Birds' },
  { id: 'MountDataAsset:DA_Mount_Terrorbird_02_05', name: 'Astralbeak Warbler', icon: 'T_Mount_Terrobird_02_05.png', group: 'Terror Birds' },
  { id: 'MountDataAsset:DA_Mount_Terrorbird_02_04', name: 'Sunkissed Clawfoot', icon: 'T_Mount_Terrobird_02_04.png', group: 'Terror Birds' },
  { id: 'MountDataAsset:DA_Mount_Terrorbird_02_03', name: 'Eclipseborn Sharpbeak', icon: 'T_Mount_Terrobird_02_03.png', group: 'Terror Birds' },
  { id: 'MountDataAsset:DA_Mount_Terrorbird_02_02', name: 'Summerbellied Wagtail', icon: 'T_Mount_Terrobird_02_02.png', group: 'Terror Birds' },
  { id: 'MountDataAsset:DA_Mount_Terrorbird_02_01', name: 'Coastal Sunbeak', icon: 'T_Mount_Terrobird_02_01.png', group: 'Terror Birds' },
  { id: 'MountDataAsset:DA_Mount_Terrorbird_03_05', name: 'Infernal Blightbeak', icon: 'T_Mount_Terrobird_03_05.png', group: 'Terror Birds' },
  { id: 'MountDataAsset:DA_Mount_Terrorbird_03_04', name: 'Crimson Crybaby', icon: 'T_Mount_Terrobird_03_04.png', group: 'Terror Birds' },
  { id: 'MountDataAsset:DA_Mount_Terrorbird_03_03', name: 'Applefeather Mosstail', icon: 'T_Mount_Terrobird_03_03.png', group: 'Terror Birds' },
  { id: 'MountDataAsset:DA_Mount_Terrorbird_03_02', name: 'Scorchsummer Ashbeak', icon: 'T_Mount_Terrobird_03_02.png', group: 'Terror Birds' },
  { id: 'MountDataAsset:DA_Mount_Terrorbird_03_01', name: 'Zamorakian Pledgesaddle', icon: 'T_Mount_Terrobird_03_01.png', group: 'Terror Birds' },
  { id: 'MountDataAsset:DA_Mount_FlyingCarpet_01_01', name: 'Magic Carpet', icon: 'T_Icon_SM_Carpet_01_01.png', group: 'Magic Carpets' },
  { id: 'MountDataAsset:DA_Mount_FlyingCarpet_01_02', name: 'Moonsilk Weave', icon: 'T_Icon_SM_Carpet_01_02.png', group: 'Magic Carpets' },
  { id: 'MountDataAsset:DA_Mount_FlyingCarpet_01_03', name: 'Scorchweave Rug', icon: 'T_Icon_SM_Carpet_01_03.png', group: 'Magic Carpets' },
  { id: 'MountDataAsset:DA_Mount_FlyingCarpet_01_04', name: 'Manafem Midnight', icon: 'T_Icon_SM_Carpet_01_04.png', group: 'Magic Carpets' },
  { id: 'MountDataAsset:DA_Mount_FlyingCarpet_01_05', name: 'Uzzerian Umber', icon: 'T_Icon_SM_Carpet_01_05.png', group: 'Magic Carpets' },
]

export const MOUNT_GROUPS = ['Terror Birds', 'Magic Carpets'] as const

const mountsById = new Map(MOUNTS.map((mount) => [mount.id, mount]))

export function mountById(id: string): MountInfo | undefined {
  return mountsById.get(id)
}

export function mountLabel(id: string): string {
  if (!id || id === 'None') return 'None'
  return mountsById.get(id)?.name
    ?? id.replace(/^MountDataAsset:DA_Mount_/, '').replace(/^MountDataAsset:/, '')
}

export const KNOWN_MOUNTS = ['None', ...MOUNTS.map((mount) => mount.id)]

export const OBSERVED_SKILL_IDS = [
  'Wf3i7Ha-B06DH719j1vtBw',
  '4pefO9k1lUqfA6mvHNi1SA',
  'waK-8EyQFQ2xEjCGYmuTRQ',
  'Tn7t6DQyX0-Q0cM5K7B90A',
  '0hreSMRVXUihq9qjDO2CFA',
  'jqX0Gh6QI0GFFPCDFK_CJQ',
  'heq7u88Q2UuLXFqLGTVwQw',
  'NOqC-z-2ckqi0El22qMFlw',
  '4zYUGF5u_0KbMLkWJmmBbQ',
  'PyUi-0LU_riFY46AnnFiWg',
  'vwY5IkQJJDwb2PKEfoc8MQ',
  'pJggvotwOkuoc98igUn7xA',
]

export const PIN_TYPES = [
  { value: 0, label: 'Animal', icon: 'T_Map_Icon_Animal.png' },
  { value: 1, label: 'Base', icon: 'T_Map_Icon_Base.png' },
  { value: 2, label: 'Lodestone', icon: 'T_Map_Icon_Ore.png' },
  { value: 3, label: 'Pin', icon: 'T_Map_Icon_Pin.png', teardrop: true },
  { value: 4, label: 'Plant', icon: 'T_Map_Icon_Plant.png' },
  { value: 5, label: 'Tree', icon: 'T_Map_Icon_Tree.png' },
] as const

export type PinTypeInfo = (typeof PIN_TYPES)[number]

export function pinTypeInfo(value: number): PinTypeInfo {
  return PIN_TYPES.find((type) => type.value === value)
    ?? PIN_TYPES.find((type) => type.value === 3)!
}
