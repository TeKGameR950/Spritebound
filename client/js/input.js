// Keyboard, mouse and gamepad input with rebindable actions.
export const DEFAULT_BINDS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  handbrake: ['Space'],
  use: ['KeyE', 'KeyF'],
  reload: ['KeyR'],
  horn: ['KeyH'],
  siren: ['KeyQ'],
  lights: ['KeyL'],
  chat: ['KeyT', 'Enter'],
  map: ['KeyM'],
  players: ['Tab'],
  talk: ['KeyV'],
  menu: ['Escape'],
  callcar: ['KeyG'],
  job: ['KeyJ'],
  wave: ['KeyB'],
  radio: ['KeyN'],
  prevWeapon: ['KeyZ'],
  nextWeapon: ['KeyX'],
  zoom: ['KeyC'],
  photo: ['KeyP'],
};

export class Input {
  constructor(target) {
    this.binds = structuredClone(DEFAULT_BINDS);
    this.down = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, left: false, right: false, leftPressed: false, rightPressed: false, wheel: 0, moved: false };
    this.enabled = true;
    this.gamepad = null;
    this.usingPad = false;
    this.typing = false;
    this.lastDevice = 'kb';
    addEventListener('keydown', (e) => {
      if (this.typing) return;
      if (e.code === 'Tab' || (e.code === 'Space' && e.target === document.body)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
      this.lastDevice = 'kb';
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => { this.down.clear(); this.mouse.left = this.mouse.right = false; });
    target.addEventListener('mousemove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.moved = true; this.lastDevice = 'kb'; });
    target.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
      this.lastDevice = 'kb';
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    for (let i = 1; i <= 9; i++) this.binds['weapon' + i] = ['Digit' + i];
  }

  is(action) {
    if (!this.enabled) return false;
    const keys = this.binds[action];
    if (keys) for (const k of keys) if (this.down.has(k)) return true;
    return this.padIs(action);
  }
  hit(action) {
    if (!this.enabled) return false;
    const keys = this.binds[action];
    if (keys) for (const k of keys) if (this.pressed.has(k)) return true;
    return this.padHit(action);
  }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    const prev = this.gamepad;
    this.gamepad = pad ? { axes: [...pad.axes], buttons: pad.buttons.map((b) => b.value), prev: prev ? prev.buttons : null } : null;
    if (pad) {
      const active = pad.axes.some((a) => Math.abs(a) > 0.3) || pad.buttons.some((b) => b.value > 0.5);
      if (active) this.lastDevice = 'pad';
    }
  }
  padBtn(i) { return this.gamepad ? this.gamepad.buttons[i] || 0 : 0; }
  padBtnHit(i) { return this.gamepad && this.gamepad.prev && (this.gamepad.buttons[i] || 0) > 0.5 && (this.gamepad.prev[i] || 0) <= 0.5; }
  padIs(action) {
    if (!this.gamepad) return false;
    switch (action) {
      case 'run': return this.padBtn(10) > 0.5 || this.padBtn(4) > 0.5;
      case 'handbrake': return this.padBtn(5) > 0.5 || this.padBtn(0) > 0.5;
      case 'horn': return this.padBtn(11) > 0.5;
      case 'talk': return this.padBtn(12) > 0.5;
      default: return false;
    }
  }
  padHit(action) {
    if (!this.gamepad) return false;
    switch (action) {
      case 'use': return this.padBtnHit(3);
      case 'reload': return this.padBtnHit(2);
      case 'menu': return this.padBtnHit(9);
      case 'map': return this.padBtnHit(8);
      case 'nextWeapon': return this.padBtnHit(15) || this.padBtnHit(1);
      case 'prevWeapon': return this.padBtnHit(14);
      case 'radio': return this.padBtnHit(13);
      case 'siren': return this.padBtnHit(12) && false;
      default: return false;
    }
  }
  // movement vector (-1..1)
  move() {
    let x = 0, y = 0;
    if (this.is('left')) x -= 1;
    if (this.is('right')) x += 1;
    if (this.is('up')) y -= 1;
    if (this.is('down')) y += 1;
    if (this.gamepad && this.enabled) {
      const ax = this.gamepad.axes[0] || 0, ay = this.gamepad.axes[1] || 0;
      if (Math.hypot(ax, ay) > 0.18) { x = ax; y = ay; }
    }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return [x, y];
  }
  padAim() {
    if (!this.gamepad || !this.enabled) return null;
    const ax = this.gamepad.axes[2] || 0, ay = this.gamepad.axes[3] || 0;
    if (Math.hypot(ax, ay) < 0.25) return null;
    return Math.atan2(ay, ax);
  }
  padTrigger(i) { return this.gamepad && this.enabled ? this.gamepad.buttons[i] || 0 : 0; }

  endFrame() {
    this.pressed.clear();
    this.mouse.leftPressed = false;
    this.mouse.rightPressed = false;
    this.mouse.wheel = 0;
    this.mouse.moved = false;
  }
}
