import type { NativeObservation } from './worker-shared.ts';

// doomdef.h weapontype_t order; NUMWEAPONS/wp_nochange are not weapons.
const weaponNames = [
  'fist',
  'pistol',
  'shotgun',
  'chaingun',
  'rocket_launcher',
  'plasma_rifle',
  'bfg9000',
  'chainsaw',
  'super_shotgun',
] as const;
// doomdef.h ammotype_t: 0..3 inventory types, 4 NUMAMMO, 5 am_noammo.
const ammoNames = ['bullets', 'shells', 'cells', 'rockets'] as const;

// The Worker gates both readers on loadComplete and owns their sampling order:
// ready weapon, extra/command fields, then armor/ammo.
export function readReadyWeapon(
  readIndex: (index: number) => number,
): NonNullable<NativeObservation['readyWeapon']> {
  const weaponId = readIndex(77);
  const ammoId = readIndex(78);
  return {
    id: weaponId,
    name: weaponNames[weaponId] ?? 'unknown',
    ammoType: ammoId === 5 ? 'none' : (ammoNames[ammoId] ?? 'unknown'),
  };
}

export function readPlayerTelemetry(
  readIndex: (index: number) => number,
  readyWeapon: NonNullable<NativeObservation['readyWeapon']>,
): Pick<NativeObservation, 'armorpoints' | 'readyWeapon' | 'ammo'> {
  return {
    armorpoints: readIndex(76),
    readyWeapon,
    ammo: {
      bullets: { current: readIndex(79), max: readIndex(83) },
      shells: { current: readIndex(80), max: readIndex(84) },
      cells: { current: readIndex(81), max: readIndex(85) },
      rockets: { current: readIndex(82), max: readIndex(86) },
    },
  };
}
