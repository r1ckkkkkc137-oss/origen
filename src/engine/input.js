// Teclado + ratón (pointer lock) + táctil (mitad izq. mueve, mitad der. mira).
export function createInput(dom) {
  const keys = new Set(), virt = new Set();   // virt: botones táctiles (touchUI) que se comportan como teclas
  const mouse = new Set();
  const look = { dx: 0, dy: 0 };
  const touchMove = { x: 0, y: 0 };
  let moveId = null, lookId = null, moveOrigin = null, lookLast = null;
  addEventListener('keydown', (e) => keys.add(e.code));
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); mouse.clear(); });
  dom.addEventListener('mousedown', (e) => { if (document.pointerLockElement === dom) mouse.add(e.button); });
  addEventListener('mouseup', (e) => mouse.delete(e.button));
  dom.addEventListener('contextmenu', (e) => e.preventDefault());
  dom.addEventListener('click', () => { if (!matchMedia('(pointer:coarse)').matches) dom.requestPointerLock?.(); });
  addEventListener('mousemove', (e) => { if (document.pointerLockElement === dom) { look.dx += e.movementX; look.dy += e.movementY; } });
  dom.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    if (e.clientX < innerWidth / 2 && moveId === null) { moveId = e.pointerId; moveOrigin = [e.clientX, e.clientY]; }
    else if (lookId === null) { lookId = e.pointerId; lookLast = [e.clientX, e.clientY]; }
  });
  dom.addEventListener('pointermove', (e) => {
    if (e.pointerId === moveId) { touchMove.x = clamp((e.clientX - moveOrigin[0]) / 60); touchMove.y = clamp((e.clientY - moveOrigin[1]) / 60); }
    else if (e.pointerId === lookId) { look.dx += (e.clientX - lookLast[0]) * 1.5; look.dy += (e.clientY - lookLast[1]) * 1.5; lookLast = [e.clientX, e.clientY]; }
  });
  const end = (e) => { if (e.pointerId === moveId) { moveId = null; touchMove.x = touchMove.y = 0; } if (e.pointerId === lookId) lookId = null; };
  dom.addEventListener('pointerup', end); dom.addEventListener('pointercancel', end);
  return {
    down: (code) => keys.has(code) || virt.has(code),
    /** botón del ratón (0 izq., 2 der.) apretado con pointer lock */
    mouseDown: (b) => mouse.has(b),
    /** tecla virtual (touchUI) */
    setVirtual(code, on) { if (on) virt.add(code); else virt.delete(code); },
    /** estado del stick táctil para dibujarlo: null o { origin:[x,y], x, y } */
    get stick() { return moveId === null ? null : { origin: moveOrigin, x: touchMove.x, y: touchMove.y }; },
    /** eje de movimiento [x(der), z(adelante)] en -1..1 */
    moveAxis() {
      let x = touchMove.x, z = -touchMove.y;
      if (keys.has('KeyD')) x += 1; if (keys.has('KeyA')) x -= 1;
      if (keys.has('KeyW')) z += 1; if (keys.has('KeyS')) z -= 1;
      return [clamp(x), clamp(z)];
    },
    consumeLook() { const r = [look.dx, look.dy]; look.dx = look.dy = 0; return r; },
  };
}
const clamp = (v) => Math.max(-1, Math.min(1, v));
