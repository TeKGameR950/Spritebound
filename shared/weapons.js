// Weapon catalogue. Damage in hit points; range in world units; rate = seconds between shots.
export const WEAPONS = [
  { key: 'fists', name: 'Fists', kind: 'melee', dmg: 9, range: 15, arc: 1.2, rate: 0.36, price: 0, icon: 'fist' },
  { key: 'bat', name: 'Baseball Bat', kind: 'melee', dmg: 24, range: 21, arc: 1.5, rate: 0.55, price: 150, icon: 'bat' },
  { key: 'pistol', name: 'Pistol', kind: 'gun', dmg: 19, range: 430, rate: 0.26, spread: 0.035, clip: 12, reload: 1.1, pellets: 1, price: 450, ammoPrice: 60, ammoPack: 36, auto: false, recoil: 1.5, shake: 1.2, icon: 'pistol' },
  { key: 'smg', name: 'Buzz SMG', kind: 'gun', dmg: 11, range: 380, rate: 0.082, spread: 0.085, clip: 32, reload: 1.4, pellets: 1, price: 1600, ammoPrice: 90, ammoPack: 96, auto: true, recoil: 1, shake: 0.8, icon: 'smg' },
  { key: 'shotgun', name: 'Pump Shotgun', kind: 'gun', dmg: 11, range: 250, rate: 0.85, spread: 0.32, clip: 6, reload: 1.8, pellets: 8, price: 2400, ammoPrice: 120, ammoPack: 24, auto: false, recoil: 4, shake: 3.2, icon: 'shotgun' },
  { key: 'rifle', name: 'Ranger Rifle', kind: 'gun', dmg: 27, range: 600, rate: 0.12, spread: 0.028, clip: 30, reload: 1.6, pellets: 1, price: 5200, ammoPrice: 160, ammoPack: 90, auto: true, recoil: 1.6, shake: 1.4, icon: 'rifle' },
  { key: 'rocket', name: 'Rocket Launcher', kind: 'proj', proj: 'rocket', dmg: 130, radius: 72, speed: 520, rate: 1.3, clip: 1, reload: 1.6, price: 12000, ammoPrice: 900, ammoPack: 3, auto: false, recoil: 5, shake: 4, icon: 'rocket' },
  { key: 'grenade', name: 'Grenades', kind: 'proj', proj: 'grenade', dmg: 110, radius: 66, speed: 300, fuse: 2.2, rate: 0.9, clip: 1, reload: 0, price: 300, ammoPrice: 300, ammoPack: 2, auto: false, recoil: 0, shake: 0, icon: 'grenade', thrown: true },
];
export const WEAPON_ID = Object.fromEntries(WEAPONS.map((w, i) => [w.key, i]));
WEAPONS.forEach((w, i) => (w.id = i));

export const ARMOR_PRICE = 250;

export function weaponDamageVs(w, targetKind) {
  if (targetKind === 'vehicle') return w.kind === 'melee' ? w.dmg * 0.4 : w.dmg * 1.4;
  return w.dmg;
}
