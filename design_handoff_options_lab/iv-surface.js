// IV Surface 3D — implied volatility across strike × DTE.
// Different from P&L surface: continuous, no break-even, uses sigma color scale.

(function () {
  const READY = () => typeof window !== 'undefined' && window.THREE;

  // IV(moneyness, dte): smile + term structure
  function ivValue(m, t01) {
    // m in [-1,1] = moneyness, t01 in [0,1] = dte/maxDte
    const smile = 0.06 * m * m - 0.025 * m;
    const term = 0.05 * (1 - t01); // short-dated higher
    return 0.22 + smile + term;
  }

  function ivColor(v) {
    // map iv approx [0.18, 0.40] to a violet-orange ramp
    const t = Math.max(0, Math.min(1, (v - 0.18) / 0.22));
    // anchors
    const lo = [0.36, 0.18, 0.55]; // violet
    const mid = [0.62, 0.32, 0.78];
    const hi = [0.96, 0.66, 0.32]; // amber
    let c;
    if (t < 0.5) {
      const k = t / 0.5;
      c = [lo[0]+(mid[0]-lo[0])*k, lo[1]+(mid[1]-lo[1])*k, lo[2]+(mid[2]-lo[2])*k];
    } else {
      const k = (t - 0.5) / 0.5;
      c = [mid[0]+(hi[0]-mid[0])*k, mid[1]+(hi[1]-mid[1])*k, mid[2]+(hi[2]-mid[2])*k];
    }
    return new THREE.Color(c[0], c[1], c[2]);
  }

  function makeLabel(text, color = '#cdd3df') {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = '600 26px ui-monospace, SF Mono, monospace';
    ctx.fillStyle = color; ctx.textBaseline = 'middle';
    ctx.fillText(text, 4, 32);
    const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(0.5, 0.125, 1);
    return sp;
  }

  // Bilinear sample over a strike × expiry IV matrix (percent values).
  // xn, zn ∈ [-1, 1]; row 0 (nearest expiry) sits at zn = -1. Falls back to the
  // procedural smile when no data is supplied (mobile still calls without data).
  function makeSampler(data) {
    if (!data || !data.iv || !data.iv.length || !data.iv[0] || data.iv[0].length < 2) {
      return { sample: (xn, zn) => ivValue(xn, (zn + 1) / 2), lo: 0.18, hi: 0.40 };
    }
    // Sanitize: nulls → nearest non-null in the row, else the global mean.
    const rows = data.iv.map((r) => r.slice());
    let sum = 0, n = 0;
    rows.forEach((r) => r.forEach((v) => { if (v != null && v > 0) { sum += v; n++; } }));
    const mean = n ? sum / n : 24;
    rows.forEach((r) => {
      for (let i = 0; i < r.length; i++) {
        if (r[i] == null || r[i] <= 0) {
          let f = null;
          for (let d = 1; d < r.length && f == null; d++) {
            if (r[i - d] != null && r[i - d] > 0) f = r[i - d];
            else if (r[i + d] != null && r[i + d] > 0) f = r[i + d];
          }
          r[i] = f != null ? f : mean;
        }
      }
    });
    const nR = rows.length, nC = rows[0].length;
    let lo = Infinity, hi = -Infinity;
    rows.forEach((r) => r.forEach((v) => { if (v < lo) lo = v; if (v > hi) hi = v; }));
    const sample = (xn, zn) => {
      const c = ((xn + 1) / 2) * (nC - 1);
      const r = nR > 1 ? ((zn + 1) / 2) * (nR - 1) : 0;
      const c0 = Math.max(0, Math.min(nC - 1, Math.floor(c))), c1 = Math.min(nC - 1, c0 + 1);
      const r0 = Math.max(0, Math.min(nR - 1, Math.floor(r))), r1 = Math.min(nR - 1, r0 + 1);
      const fc = c - c0, fr = r - r0;
      const top = rows[r0][c0] * (1 - fc) + rows[r0][c1] * fc;
      const bot = rows[r1][c0] * (1 - fc) + rows[r1][c1] * fc;
      return (top * (1 - fr) + bot * fr) / 100; // percent → decimal
    };
    return { sample, lo: lo / 100, hi: hi / 100 };
  }

  function makeIVSurface({ container, segments = 70, data }) {
    if (!READY() || !container) return null;
    container.innerHTML = '';
    const w = container.clientWidth, h = container.clientHeight;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, w/h, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const size = 2;
    const geom = new THREE.PlaneGeometry(size, size, segments, segments);
    geom.rotateX(-Math.PI / 2);
    const colors = new Float32Array(geom.attributes.position.count * 3);
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.4, metalness: 0.12, clearcoat: 0.7,
      clearcoatRoughness: 0.22, side: THREE.DoubleSide, opacity: 0.97, transparent: true,
      emissive: new THREE.Color(0x191b28), emissiveIntensity: 0.3,
    });
    scene.add(new THREE.Mesh(geom, mat));

    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geom), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.10 }));
    scene.add(wire);

    // Dynamic tick labels (IV %, strike ends, expiry ends) — cleared and
    // refilled on every data update.
    const tickGroup = new THREE.Group();
    scene.add(tickGroup);

    function rebuild(d) {
      const { sample, lo, hi } = makeSampler(d);
      const span = Math.max(hi - lo, 0.02);
      const pos = geom.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const xn = pos.getX(i) / (size/2);
        const zn = pos.getZ(i) / (size/2);
        const v = sample(xn, zn);
        const t = (v - lo) / span;
        pos.setY(i, t * 0.85);
        // Reuse the violet→amber ramp: it maps [0.18, 0.40] → t, so feed it the
        // normalized position on that same range regardless of the data's span.
        const cc = ivColor(0.18 + t * 0.22);
        colors[i*3] = cc.r; colors[i*3+1] = cc.g; colors[i*3+2] = cc.b;
      }
      pos.needsUpdate = true;
      geom.attributes.color.needsUpdate = true;
      geom.computeVertexNormals();
      wire.geometry.dispose();
      wire.geometry = new THREE.WireframeGeometry(geom);

      // Refill tick labels.
      while (tickGroup.children.length) {
        const ch = tickGroup.children.pop();
        if (ch.material) { if (ch.material.map) ch.material.map.dispose(); ch.material.dispose(); }
        if (ch.geometry) ch.geometry.dispose();
      }
      const axColor = '#aab4c2';
      const pct = (v) => (v * 100).toFixed(0) + '%';
      [
        { y: 0.85, t: pct(hi) }, { y: 0.425, t: pct((lo + hi) / 2) }, { y: 0, t: pct(lo) },
      ].forEach(({ y, t }) => {
        const s = makeLabel(t, axColor); s.position.set(-1.05, y + 0.02, -1); s.scale.set(0.4, 0.1, 1); tickGroup.add(s);
        const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1,y,-1), new THREE.Vector3(-0.94,y,-1)]);
        tickGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xaab4c2, transparent: true, opacity: 0.4 })));
      });
      if (d && d.strikes && d.strikes.length > 1) {
        const fmtK = (k) => (d.strikes[1] - d.strikes[0] < 1 ? k.toFixed(2) : String(Math.round(k)));
        const s0 = makeLabel(fmtK(d.strikes[0]), axColor); s0.position.set(-0.9, 0.14, -1.1); s0.scale.set(0.4, 0.1, 1); tickGroup.add(s0);
        const s1 = makeLabel(fmtK(d.strikes[d.strikes.length - 1]), axColor); s1.position.set(1.0, 0.14, -1.1); s1.scale.set(0.4, 0.1, 1); tickGroup.add(s1);
      }
      if (d && d.expiries && d.expiries.length > 1) {
        const e0 = makeLabel(`${d.expiries[0].label} ${d.expiries[0].dte}d`, axColor); e0.position.set(-1.12, 0.14, -0.8); e0.scale.set(0.42, 0.105, 1); tickGroup.add(e0);
        const eN = d.expiries[d.expiries.length - 1];
        const e1 = makeLabel(`${eN.label} ${eN.dte}d`, axColor); e1.position.set(-1.12, 0.14, 1.0); e1.scale.set(0.42, 0.105, 1); tickGroup.add(e1);
      }
    }
    rebuild(data);

    // Axes
    const axColor = '#aab4c2';
    function axisLine(a, b) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
      return new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xaab4c2, transparent: true, opacity: 0.5 }));
    }
    scene.add(axisLine([-1,0,-1],[1,0,-1]));
    scene.add(axisLine([-1,0,-1],[-1,0,1]));
    scene.add(axisLine([-1,0,-1],[-1,1,-1]));
    const lblX = makeLabel('STRIKE →', axColor); lblX.position.set(0.6, 0.05, -1.1); scene.add(lblX);
    const lblY = makeLabel('DTE →', axColor); lblY.position.set(-1.15, 0.05, 0.6); scene.add(lblY);
    const lblZ = makeLabel('IV %', axColor); lblZ.position.set(-1.05, 1.0, -1); scene.add(lblZ);
    // IV % tick labels live in tickGroup (rebuilt per data update) — see rebuild().

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const k = new THREE.DirectionalLight(0xffffff, 1.1); k.position.set(3,5,2); scene.add(k);
    const r = new THREE.DirectionalLight(0xa78bfa, 0.7); r.position.set(-3,2,-3); scene.add(r);
    const acc = new THREE.PointLight(0xff9d54, 0.9, 8); acc.position.set(2,2,2); scene.add(acc);

    const orbit = { az: -0.6, el: 0.55, dist: 3.5, target: new THREE.Vector3(0, 0.05, 0) };
    function applyCam() {
      const x = orbit.dist * Math.cos(orbit.el) * Math.sin(orbit.az);
      const y = orbit.dist * Math.sin(orbit.el);
      const z = orbit.dist * Math.cos(orbit.el) * Math.cos(orbit.az);
      camera.position.set(x, y, z);
      camera.lookAt(orbit.target);
    }
    applyCam();
    let drag = false, lx=0, ly=0;
    // Stop the idle auto-spin once the user has orbited by hand (owner request).
    let userMoved = false;
    const dom = renderer.domElement; dom.style.cursor = 'grab';
    dom.style.touchAction = 'none';
    const isTouch = !window.matchMedia || !window.matchMedia('(hover: hover)').matches;
    const rotSens = isTouch ? 0.012 : 0.005;
    dom.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; dom.setPointerCapture(e.pointerId); dom.style.cursor='grabbing'; });
    dom.addEventListener('pointermove', (e) => {
      if (!drag) return;
      userMoved = true;
      orbit.az -= (e.clientX - lx) * rotSens;
      orbit.el = Math.max(0.05, Math.min(Math.PI/2 - 0.05, orbit.el + (e.clientY - ly) * rotSens));
      lx = e.clientX; ly = e.clientY; applyCam();
    });
    dom.addEventListener('pointerup', (e) => { drag = false; dom.style.cursor='grab'; try{dom.releasePointerCapture(e.pointerId);}catch(_){} });
    dom.addEventListener('wheel', (e) => { e.preventDefault(); orbit.dist = Math.max(2, Math.min(7, orbit.dist + e.deltaY * 0.003)); applyCam(); }, {passive:false});

    // Pinch-to-zoom for touch.
    let pinchStartDist = 0, pinchStartCamDist = 0;
    dom.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchStartDist = Math.hypot(dx, dy);
        pinchStartCamDist = orbit.dist;
        drag = false;
      }
    }, {passive:false});
    dom.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && pinchStartDist > 0) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const d = Math.hypot(dx, dy);
        if (d > 0) {
          orbit.dist = Math.max(2, Math.min(7, pinchStartCamDist * (pinchStartDist / d)));
          applyCam();
        }
      }
    }, {passive:false});
    dom.addEventListener('touchend', () => { pinchStartDist = 0; });
    dom.addEventListener('touchcancel', () => { pinchStartDist = 0; });

    let raf = 0, last = performance.now(), idle = 0, isVisible = true;
    function tick(now) {
      const dt = (now - last) / 1000; last = now;
      // Auto-rotate disabled on touch (annoying on phones, also wastes battery).
      if (!drag) { idle += dt; if (!isTouch && !userMoved && idle > 1.5) orbit.az += dt * 0.04; applyCam(); } else idle = 0;
      renderer.render(scene, camera);
      raf = isVisible ? requestAnimationFrame(tick) : 0;
    }
    raf = requestAnimationFrame(tick);
    // Pause render loop when canvas is scrolled off-screen — IV surface eats GPU
    // even when not visible, which makes mobile scrolling lag.
    const io = ('IntersectionObserver' in window) ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        isVisible = e.isIntersecting;
        if (isVisible && !raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
      }
    }, { threshold: 0 }) : null;
    if (io) io.observe(container);
    const ro = new ResizeObserver(() => {
      const W = container.clientWidth, H = container.clientHeight;
      if (!W || !H) return;
      renderer.setSize(W, H); camera.aspect = W/H; camera.updateProjectionMatrix();
    });
    ro.observe(container);
    return {
      // Update the surface in place (no WebGL remount) — used when the What-if
      // spot/IV sliders regenerate the chain grid.
      setData(d) { try { rebuild(d); } catch (e) { console.error('IVSurface3D.setData failed', e); } },
      destroy() { cancelAnimationFrame(raf); ro.disconnect(); if (io) io.disconnect(); renderer.dispose(); if(dom.parentNode) dom.parentNode.removeChild(dom); },
    };
  }

  window.IVSurface3D = { make: makeIVSurface };
})();
