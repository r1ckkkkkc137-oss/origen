import * as THREE from 'three';
// Modos: 'third' (orbita un target), 'first' (ojo en el target, sin orbitar), 'free' (vuelo). Tecla C cicla `opts.cycle`.
export function createCameraRig(camera, input, opts = {}) {
  let mode = opts.mode ?? 'free';
  let yaw = opts.yaw ?? 0, pitch = opts.pitch ?? -0.3, dist = opts.dist ?? 4.5;
  const baseSpeed = opts.speed ?? 6;
  const pos = new THREE.Vector3(...(opts.pos ?? [0, 3, 6]));
  const target = new THREE.Vector3();
  const fwd = new THREE.Vector3(), right = new THREE.Vector3();
  let cWas = false, curDist = dist;
  const back = new THREE.Vector3();
  const cycle = opts.cycle ?? ['free', 'third'];
  return {
    get mode() { return mode; },
    setMode(m) { mode = m; },
    get yaw() { return yaw; },
    get pitch() { return pitch; },
    /** fija la mirada (tests, cinemáticas) */
    setLook(y, p) { yaw = y; pitch = Math.max(-1.5, Math.min(1.5, p)); },
    setTarget(v) { target.copy(v); },
    update(dt) {
      const c = input.down('KeyC'); if (c && !cWas) { mode = cycle[(cycle.indexOf(mode) + 1) % cycle.length]; opts.onMode?.(mode); } cWas = c;
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
      } else if (mode === 'first') {
        camera.position.copy(target); pos.copy(target);
        camera.lookAt(target.x + fwd.x, target.y + fwd.y, target.z + fwd.z);
      } else {
        back.copy(fwd).negate();
        const want = opts.collide ? opts.collide(target, back, dist) : dist;
        curDist = want < curDist ? want : Math.min(want, curDist + dt * 6);   // entra de golpe, sale suave
        camera.position.copy(target).addScaledVector(fwd, -curDist);
        camera.lookAt(target);
        pos.copy(camera.position);
      }
    },
  };
}
