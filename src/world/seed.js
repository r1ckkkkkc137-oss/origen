// Seed -> entero sin signo de 32 bits, con las mismas reglas que createRng() de src/shared/rng.js (número tal cual, string por hashSeed).
import { hashSeed } from '../shared/rng.js';
export const normalizeSeed = (seed) => (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;
