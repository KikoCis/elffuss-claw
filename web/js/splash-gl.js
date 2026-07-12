// Galaxia de partículas WebGL para el splash — sin librerías, autocontenida.
// Técnica: GL_POINTS + blending aditivo + rotación diferencial calculada por
// completo en el vertex shader desde una semilla (la CPU no toca nada por
// frame). ~24k partículas en espiral rosa→violeta con motas doradas, parallax
// de ratón y explosión al pulsar Entrar.
export function startGalaxy(container) {
  const canvas = document.createElement('canvas');
  canvas.className = 'gl';
  container.prepend(canvas);
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false });
  if (!gl) { canvas.remove(); return null; } // fallback: se queda el gradiente CSS

  const N = 24000;
  const seeds = new Float32Array(N * 2);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();

  const VS = `
attribute vec2 seed;
uniform float t, aspect, burst, dpr;
uniform vec2 par;
varying vec3 vColor;
varying float vGlow;
float hash(float n){ return fract(sin(n) * 43758.5453); }
void main(){
  float r = 0.08 + 1.35 * pow(seed.y, 0.65);
  float arm = floor(hash(seed.x * 7.0 + seed.y) * 3.0);
  float ang = seed.x * 0.9 + arm * 2.0944 + r * 2.6 + t * (0.12 + 0.25 / (r + 0.2));
  float wob = (hash(seed.x * 13.1) - 0.5) * 0.22 * r;
  vec2 p = vec2(cos(ang), sin(ang)) * (r + wob);
  p.y *= 0.62;
  p.y += (hash(seed.y * 17.7) - 0.5) * 0.14;
  p += par * (0.03 + r * 0.06);
  p *= 1.0 + burst * (0.4 + seed.y * 2.4);
  gl_Position = vec4(p.x / aspect, p.y, 0.0, 1.0);
  float tw = 0.55 + 0.45 * sin(t * (1.5 + seed.x * 3.0) + seed.y * 40.0);
  vGlow = tw * (1.0 - burst * 0.55);
  float gold = step(0.93, hash(seed.x * 31.3 + seed.y * 7.7));
  vec3 pink = vec3(1.0, 0.30, 0.55);
  vec3 violet = vec3(0.49, 0.36, 1.0);
  vec3 goldc = vec3(1.0, 0.84, 0.42);
  vColor = mix(mix(pink, violet, smoothstep(0.1, 1.3, r)), goldc, gold);
  gl_PointSize = (1.3 + 2.8 * tw * max(1.2 - r * 0.5, 0.2)) * dpr;
}`;
  const FS = `
precision mediump float;
varying vec3 vColor;
varying float vGlow;
void main(){
  float m = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
  gl_FragColor = vec4(vColor * vGlow, m * vGlow);
}`;

  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW); // una vez; la GPU manda
  const loc = gl.getAttribLocation(prog, 'seed');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = n => gl.getUniformLocation(prog, n);
  const uT = U('t'), uAspect = U('aspect'), uBurst = U('burst'), uPar = U('par'), uDpr = U('dpr');

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // aditivo = brillo
  gl.clearColor(0, 0, 0, 0);

  let burstAt = 0, alive = true;
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  const onMove = e => {
    mouse.tx = (e.clientX / innerWidth - 0.5) * 2;
    mouse.ty = -(e.clientY / innerHeight - 0.5) * 2;
  };
  addEventListener('pointermove', onMove);

  const dpr = Math.min(devicePixelRatio || 1, 2);
  function frame(now) {
    if (!alive) return;
    const w = container.clientWidth, h = container.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;
    const t = now / 1000;
    const burst = burstAt ? Math.min((now - burstAt) / 900, 1) : 0;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(uT, t);
    gl.uniform1f(uAspect, w / h);
    gl.uniform1f(uBurst, burst);
    gl.uniform1f(uDpr, dpr);
    gl.uniform2f(uPar, mouse.x, mouse.y);
    gl.drawArrays(gl.POINTS, 0, N);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    burst() { burstAt = performance.now(); },
    stop() { alive = false; removeEventListener('pointermove', onMove); canvas.remove(); },
  };
}
