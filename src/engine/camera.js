import * as THREE from 'three';
// Cámara libre (vuelo) y tercera persona (orbita un target). Tecla C alterna.
export function createCameraRig(camera, input, opts = {}) {
  let mode = opts.mode ?? 'free';
  let yaw = opts.yaw ?? 0, pitch = opts.pitch ?? -0.3, dist = opts.dist ?? 4.5;
  const baseSpeed = opts.speed ?? 6;
  const pos = new THREE.Vector3(...(opts.pos ?? [0, 3, 6]));
  const target = new THREE.Vector3();
  const fwd = new THREE.Vector3(), right = new THREE.Vector3();
  let cWas = false;
  return {
    get mode() { return mode; },
    setMode(m) { mode = m; },
    setTarget(v) { target.copy(v); },
    update(dt) {
      const c = input.down('KeyC'); if (c && !cWas) mode = mode === 'free' ? 'third' : 'free'; cWas = c;
      const [lx, ly] = input.consumeLook();
      yaw -= lx * 0.0025; pitch = Math.max(-1.5, Math.min(1.5, pitch - ly * 0.0025));
      fwd.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      if (mode === 'free') {
        const [mx, mz] = input.moveAxis();
        const speed = (input.down('ShiftLeft') ? baseSpeed * 3 : baseSpeed) * dt;
        right.set(Math.cos(yaw), 0, -Math.sin(yaw));
        pos.addScaledVector(fwd, mz * speed).addScaledVector(right, mx * speed);
        if (input.down('Space')) pos.y += speed; if (input.down('ControlLeft') || input.down('KeyQ')) pos.y -= speed;
        camera.position.copy(pos);
        camera.lookAt(pos.x + fwd.x, pos.y + fwd.y, pos.z + fwd.z);
      } else {
        camera.position.copy(target).addScaledVector(fwd, -dist);
        camera.lookAt(target);
        pos.copy(camera.position);
      }
    },
  };
}
