// Terrenos a mano para pruebas. Coordenadas de celda mundo (x adelante, y arriba, z derecha); blockM metros por celda.
// flat(): suelo en y=0 (celda iy<0 sólida => tope en 0).
export const flat = () => (x, y, z) => y < 0;
// stepTerrain: plano hasta x < stepX (celdas), y desde ahí una plataforma `h` bloques más alta (ancho infinito en z).
export const stepTerrain = (stepX = 4, h = 1) => (x, y, z) => y < (x >= stepX ? h : 0);
// stairs: escalera ascendente de `n` escalones cada `w` celdas.
export const stairs = (x0 = 2, w = 2, n = 3) => (x, y, z) => y < (x < x0 ? 0 : Math.min(n, 1 + Math.floor((x - x0) / w)));
