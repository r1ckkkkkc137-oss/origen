// Controles táctiles (APK / celular): stick a la izquierda (lo maneja input.js; aquí solo se dibuja) y botones a la derecha que actúan
// como teclas virtuales: saltar (Space), cavar (Dig), poner (Place), siguiente bloque (Next), cámara (KeyC). Solo aparece con pointer:coarse
// o con ?touch=1. Los botones son DOM encima del canvas: el toque en un botón no mueve la cámara.
export function createTouchUI(input, opts = {}) {
  const force = opts.force ?? false;
  if (!force && !matchMedia('(pointer:coarse)').matches) return null;
  const root = document.createElement('div');
  root.id = 'touch-ui';
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:10;user-select:none;-webkit-user-select:none;touch-action:none';
  const B = (label, code, right, bottom, size = 64) => {
    const b = document.createElement('div');
    b.textContent = label; b.dataset.code = code;
    b.style.cssText = `position:absolute;right:${right}px;bottom:${bottom}px;width:${size}px;height:${size}px;border-radius:50%;` +
      'background:rgba(20,20,20,.45);border:2px solid rgba(230,230,230,.5);color:#eee;font:600 13px system-ui;display:flex;' +
      'align-items:center;justify-content:center;pointer-events:auto;touch-action:none';
    const on = (e) => { e.preventDefault(); input.setVirtual(code, true); b.style.background = 'rgba(200,60,50,.6)'; };
    const off = (e) => { e.preventDefault(); input.setVirtual(code, false); b.style.background = 'rgba(20,20,20,.45)'; };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
    root.appendChild(b); return b;
  };
  B('SALTO', 'Space', 24, 24, 78);
  B('CAVAR', 'Dig', 112, 40);
  B('PONER', 'Place', 40, 114);
  B('BLOQ', 'Next', 128, 124, 52);
  B('CAM', 'KeyC', 24, 200, 48);
  const ring = document.createElement('div'), knob = document.createElement('div');
  ring.style.cssText = 'position:absolute;width:120px;height:120px;margin:-60px 0 0 -60px;border-radius:50%;border:2px solid rgba(230,230,230,.35);display:none';
  knob.style.cssText = 'position:absolute;width:50px;height:50px;margin:-25px 0 0 -25px;border-radius:50%;background:rgba(230,230,230,.35);display:none';
  root.append(ring, knob);
  document.body.appendChild(root);
  return {
    root,
    update() {
      const s = input.stick;
      ring.style.display = knob.style.display = s ? 'block' : 'none';
      if (s) { ring.style.left = `${s.origin[0]}px`; ring.style.top = `${s.origin[1]}px`; knob.style.left = `${s.origin[0] + s.x * 60}px`; knob.style.top = `${s.origin[1] + s.y * 60}px`; }
    },
  };
}
