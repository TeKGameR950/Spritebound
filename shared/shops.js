import { WEAPONS } from './weapons.js';
import { VEHICLES } from './vehicles.js';

// Shop catalogues, shared so the client can render menus and the server can validate.
const gunItems = [];
for (const w of WEAPONS) {
  if (w.price) gunItems.push({ id: 'w:' + w.key, name: w.name, price: w.price, desc: w.kind === 'melee' ? 'Melee' : `${w.dmg * (w.pellets || 1)} dmg` });
  if (w.ammoPrice && w.key !== 'grenade') gunItems.push({ id: 'a:' + w.key, name: `${w.name} ammo x${w.ammoPack}`, price: w.ammoPrice, ammo: w.key });
}
gunItems.push({ id: 'armor', name: 'Body Armor', price: 250, desc: '+100 armor' });

export const SHOPS = {
  gunshop: { title: 'Outfitters', verb: 'Shop', items: gunItems },
  clothes: { title: 'Tailor', verb: 'Change outfit', items: [{ id: 'makeover', name: 'Full makeover', price: 120, desc: 'Change your whole look' }] },
  respray: { title: 'Respray Garage', verb: 'Respray', needsCar: true, items: [{ id: 'respray', name: 'New paint job', price: 150, desc: 'Fresh color, cops forget your face' }, { id: 'repair', name: 'Full repair', price: 200, desc: 'Fix all damage' }] },
  clinic: { title: 'Clinic', verb: 'Visit', items: [{ id: 'heal', name: 'Patch me up', price: 80, heal: 100, desc: 'Full health' }] },
  cafe: { title: 'Cafe', verb: 'Order', items: [{ id: 'coffee', name: 'Hot cocoa', price: 6, heal: 15 }, { id: 'muffin', name: 'Blueberry muffin', price: 10, heal: 25 }, { id: 'sandwich', name: 'Cozy sandwich', price: 16, heal: 45 }] },
  diner: { title: 'Diner', verb: 'Order', items: [{ id: 'burger', name: 'Starlight burger', price: 18, heal: 50 }, { id: 'shake', name: 'Milkshake', price: 9, heal: 20 }, { id: 'fries', name: 'Fries', price: 6, heal: 12 }] },
  gas: { title: 'Gas & Snacks', verb: 'Shop', items: [{ id: 'repair', name: 'Quick repair', price: 120, desc: 'Fix your car', needsCar: true }, { id: 'snack', name: 'Gummy worms', price: 4, heal: 10 }, { id: 'soda', name: 'Fizzy soda', price: 3, heal: 6 }] },
  dealer: {
    title: 'Car Dealer', verb: 'Browse cars',
    items: VEHICLES.filter((v) => v.price > 0).map((v) => ({ id: 'car:' + v.key, name: v.name, price: v.price, desc: `Top speed ${Math.round(v.maxSpeed / 8 * 3.6)} km/h` })),
  },
  pizza: { title: 'Pizza Pals', verb: 'Deliver pizzas', items: [{ id: 'job:pizza', name: 'Start delivery shift', price: 0, desc: 'Ride the scooter, deliver hot pizzas' }] },
  taxi: { title: 'Sunny Cabs', verb: 'Drive a cab', items: [{ id: 'job:taxi', name: 'Take a cab out', price: 0, desc: 'Pick up fares around town' }] },
  hotel: { title: 'Hotel Bellwater', verb: 'Rest', items: [{ id: 'rest', name: 'Nap in the lobby', price: 30, heal: 100, desc: 'Full health' }] },
  arcade: { title: 'Pixel Palace', verb: 'Play', items: [{ id: 'arcade', name: 'Play a round', price: 5, desc: 'Win up to $60' }] },
  cityhall: { title: 'City Hall', verb: 'Hall of Fame', items: [{ id: 'board', name: 'View leaderboards', price: 0 }] },
};

export function findItem(shop, id) {
  const s = SHOPS[shop];
  if (!s) return null;
  return s.items.find((i) => i.id === id) || null;
}
