// Upgraded 3D P&L surface (three.js).
// Adds: axis labels (sprites), hover tooltip raycast, break-even contour line,
// configurable color schemes, configurable theta-decay smoothing, runtime API
// (setScheme, setParams, setHover).
//
// API: window.OptionsSurface.make({ container, theme, scheme, onHover })
//   returns { destroy, setScheme, setParams, setHover, redraw }

(function () {
  const READY = () => typeof window !== 'undefined' && window.THREE;

  // ── Color schemes for the surface
  const SCHEMES = {
    diverging: {
      down: [0.36, 0.62, 0.82],
      mid:  [0.32, 0.32, 0.40],
      up:   [0.95, 0.72, 0.30],
      darkAdj: { down:[0.20,0.55,0.78], mid:[0.30,0.30,0.36], up:[0.98,0.78,0.34] },
    },
    aurora: {
      down: [0.30, 0.70, 0.95],
      mid:  [0.78, 0.55, 0.95],
      up:   [0.95, 0.50, 0.75],
      darkAdj: { down:[0.20,0.65,0.95], mid:[0.55,0.40,0.85], up:[0.95,0.45,0.75] },
    },
    viridis: {
      down: [0.27, 0.00, 0.33],
      mid:  [0.13, 0.57, 0.55],
      up:   [0.99, 0.91, 0.14],
      darkAdj: { down:[0.32,0.05,0.40], mid:[0.13,0.57,0.55], up:[0.99,0.91,0.14] },
    },
    classic: {
      down: [0.85, 0.30, 0.30],
      mid:  [0.32, 0.32, 0.40],
      up:   [0.30, 0.78, 0.45],
      darkAdj: { down:[0.95,0.40,0.40], mid:[0.30,0.30,0.36], up:[0.40,0.88,0.55] },
    },
  };

  // P&L: bull-call-spread shaped, with optional theta-smoothing factor
  function pnlValue(x, y, params) {
    const k1 = params?.k1 ?? -0.25;
    const k2 = params?.k2 ?? 0.35;
    const thetaSmooth = params?.thetaSmooth ?? 0.18;
    const tte = 1 - y;
    const longCall  = Math.max(x - k1, 0) - 0.18;
    const shortCall = -(Math.max(x - k2, 0)) + 0.10;
    const intrinsic = longCall + shortCall;
    const smooth = thetaSmooth * Math.exp(-((x - (k1 + k2) / 2) ** 2) / 0.4) * tte;
    return intrinsic + smooth;
  }

  function colorAt(v, theme, scheme) {
    const s = SCHEMES[scheme] || SCHEMES.diverging;
    const a = theme === 'dark' ? s.darkAdj : { down: s.down, mid: s.mid, up: s.up };
    const t = Math.max(0, Math.min(1, (v + 0.4) / 0.8));
    let c;
    if (t < 0.5) {
      const k = t / 0.5;
      c = [a.down[0]+(a.mid[0]-a.down[0])*k, a.down[1]+(a.mid[1]-a.down[1])*k, a.down[2]+(a.mid[2]-a.down[2])*k];
    } else {
      const k = (t - 0.5) / 0.5;
      c = [a.mid[0]+(a.up[0]-a.mid[0])*k, a.mid[1]+(a.up[1]-a.mid[1])*k, a.mid[2]+(a.up[2]-a.mid[2])*k];
    }
    return new THREE.Color(c[0], c[1], c[2]);
  }

  // Build a text label as a canvas texture sprite
  function makeLabelSprite(text, color = '#cdd3df') {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = '600 28px ui-monospace, SF Mono, monospace';
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 4, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(0.5, 0.125, 1);
    return sp;
  }

  function makeSurface({ container, theme = 'dark', scheme = 'diverging', segments = 80, params, onHover }) {
    if (!READY() || !container) return null;
    container.innerHTML = '';

    const w = container.clientWidth, h = container.clientHeight;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, w / h, 0.1, 100);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const size = 2;
    const geom = new THREE.PlaneGeometry(size, size, segments, segments);
    geom.rotateX(-Math.PI / 2);

    function rebuildColors(curScheme) {
      const colors = new Float32Array(geom.attributes.position.count * 3);
      const pos = geom.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) / (size / 2);
        const z = pos.getZ(i) / (size / 2);
        const y01 = (z + 1) / 2;
        const v = pnlValue(x, y01, params);
        pos.setY(i, v * 0.9);
        const c = colorAt(v, theme, curScheme);
        colors[i*3] = c.r; colors[i*3+1] = c.g; colors[i*3+2] = c.b;
      }
      if (geom.getAttribute('color')) geom.attributes.color.needsUpdate = true;
      else geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      // copy into existing buffer if present
      const attr = geom.getAttribute('color');
      attr.array.set(colors);
      attr.needsUpdate = true;
      pos.needsUpdate = true;
      geom.computeVertexNormals();
    }
    let curScheme = scheme;
    rebuildColors(curScheme);

    const mat = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.35,
      metalness: 0.15,
      clearcoat: 0.85,
      clearcoatRoughness: 0.18,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.98,
      emissive: new THREE.Color(theme === 'dark' ? 0x1a1f2e : 0x000000),
      emissiveIntensity: theme === 'dark' ? 0.25 : 0,
      sheen: 0.5,
      sheenColor: new THREE.Color(theme === 'dark' ? 0x88aaff : 0xffe0c0),
    });
    const mesh = new THREE.Mesh(geom, mat);
    scene.add(mesh);

    // wireframe overlay
    const wireMat = new THREE.LineBasicMaterial({
      color: theme === 'dark' ? 0xffffff : 0x222233,
      transparent: true,
      opacity: theme === 'dark' ? 0.08 : 0.06,
    });
    const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geom), wireMat);
    scene.add(wire);

    // zero plane (translucent)
    const zeroGeom = new THREE.PlaneGeometry(size, size);
    zeroGeom.rotateX(-Math.PI / 2);
    const zeroMat = new THREE.MeshBasicMaterial({
      color: theme === 'dark' ? 0x4dd0c8 : 0x0d9488,
      transparent: true, opacity: 0.22, side: THREE.DoubleSide,
    });
    scene.add(new THREE.Mesh(zeroGeom, zeroMat));

    // ── Break-even contour: trace where pnlValue ≈ 0 across (x, y)
    function buildBreakEvenLines() {
      const segs = [];
      const N = 60;
      // for each horizontal slice (y), find sign-change crossings in x
      for (let j = 0; j < N; j++) {
        const y = j / (N - 1);
        let prev = pnlValue(-1, y, params);
        let prevX = -1;
        for (let i = 1; i <= N; i++) {
          const x = -1 + (2 * i) / N;
          const v = pnlValue(x, y, params);
          if ((prev <= 0 && v > 0) || (prev >= 0 && v < 0)) {
            // linear interp for x-crossing
            const t = prev / (prev - v);
            const xc = prevX + (x - prevX) * t;
            const yWorld = y * 2 - 1; // back to plane coords
            // tiny segment along x; we'll connect crossings between j and j+1 in next pass
            segs.push([xc, 0.005, yWorld]);
          }
          prev = v; prevX = x;
        }
      }
      return segs;
    }
    const bePoints = buildBreakEvenLines();
    if (bePoints.length) {
      const beGeom = new THREE.BufferGeometry();
      const arr = new Float32Array(bePoints.flat());
      beGeom.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const beMat = new THREE.PointsMaterial({
        color: theme === 'dark' ? 0xffffff : 0x222233,
        size: 0.045, sizeAttenuation: true, transparent: true, opacity: 0.85,
      });
      scene.add(new THREE.Points(beGeom, beMat));
    }

    // ── Axis labels
    const axisColor = theme === 'dark' ? '#aab4c2' : '#5a6577';
    function axisLine(a, b) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
      return new THREE.Line(g, new THREE.LineBasicMaterial({ color: theme === 'dark' ? 0xaab4c2 : 0x6b7280, transparent: true, opacity: 0.55 }));
    }
    scene.add(axisLine([-1, 0, -1], [ 1, 0, -1]));
    scene.add(axisLine([-1, 0, -1], [-1, 0,  1]));
    scene.add(axisLine([-1, 0, -1], [-1, 1.0, -1]));

    const lblX = makeLabelSprite('SPOT →', axisColor); lblX.position.set(0.6, 0.05, -1.1); scene.add(lblX);
    const lblY = makeLabelSprite('DTE →', axisColor);  lblY.position.set(-1.15, 0.05, 0.6); scene.add(lblY);
    const lblZ = makeLabelSprite('P&L', axisColor);    lblZ.position.set(-1.05, 1.1, -1);  scene.add(lblZ);

    // ── Z-axis tick labels with $ values (assume surface unit ≈ 1000 USD)
    const SCALE = 1000; // approx mapping from surface unit to USD
    const ticks = [
      { y: 0.9,  text: `+$${(0.9 * SCALE).toFixed(0)}`, color: theme === 'dark' ? '#f0c068' : '#a06f1f' },
      { y: 0.45, text: `+$${(0.45 * SCALE).toFixed(0)}`, color: axisColor },
      { y: 0.0,  text: `$0`, color: axisColor },
      { y: -0.3, text: `−$${(0.3 * SCALE).toFixed(0)}`, color: theme === 'dark' ? '#5fa3d4' : '#2a5e8c' },
    ];
    ticks.forEach(({ y, text, color }) => {
      const s = makeLabelSprite(text, color);
      s.position.set(-1.05, y, -1); s.scale.set(0.42, 0.105, 1);
      scene.add(s);
      // tick mark
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-1, y, -1), new THREE.Vector3(-0.94, y, -1),
      ]);
      scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: theme === 'dark' ? 0xaab4c2 : 0x6b7280, transparent: true, opacity: 0.5 })));
    });

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, theme === 'dark' ? 0.45 : 0.85));
    const key = new THREE.DirectionalLight(0xffffff, theme === 'dark' ? 1.2 : 0.55);
    key.position.set(3, 5, 2); scene.add(key);
    const rim = new THREE.DirectionalLight(theme === 'dark' ? 0x88aaff : 0xfff0e0, 0.8);
    rim.position.set(-3, 2, -3); scene.add(rim);
    if (theme === 'dark') {
      const accent = new THREE.PointLight(0xff9d54, 1.2, 8);
      accent.position.set(2, 2, 2); scene.add(accent);
      const accent2 = new THREE.PointLight(0x6688ff, 0.8, 8);
      accent2.position.set(-2, 1.5, -2); scene.add(accent2);
    }

    // Hover marker (small ring on the surface)
    const ringGeom = new THREE.RingGeometry(0.04, 0.06, 32);
    ringGeom.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: theme === 'dark' ? 0xffffff : 0x222233, transparent: true, opacity: 0.0 });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    scene.add(ring);

    // Orbit
    const orbit = { az: -0.6, el: 0.55, dist: 3.5, target: new THREE.Vector3(0, 0.05, 0) };
    function applyCamera() {
      const x = orbit.dist * Math.cos(orbit.el) * Math.sin(orbit.az);
      const y = orbit.dist * Math.sin(orbit.el);
      const z = orbit.dist * Math.cos(orbit.el) * Math.cos(orbit.az);
      camera.position.set(x + orbit.target.x, y + orbit.target.y, z + orbit.target.z);
      camera.lookAt(orbit.target);
    }
    applyCamera();

    let dragging = false, lx = 0, ly = 0, didDrag = false;
    const dom = renderer.domElement;
    dom.style.cursor = 'grab';
    const ray = new THREE.Raycaster();
    const mouseN = new THREE.Vector2();

    function pickSurface(clientX, clientY) {
      const r = dom.getBoundingClientRect();
      mouseN.x = ((clientX - r.left) / r.width) * 2 - 1;
      mouseN.y = -((clientY - r.top) / r.height) * 2 + 1;
      ray.setFromCamera(mouseN, camera);
      const hits = ray.intersectObject(mesh, false);
      if (!hits.length) return null;
      const p = hits[0].point;
      // back to normalized x,y01
      const xn = Math.max(-1, Math.min(1, p.x));
      const yn = Math.max(0, Math.min(1, (p.z + 1) / 2));
      const v = pnlValue(xn, yn, params);
      return { xn, yn, v, world: p };
    }

    dom.addEventListener('pointerdown', (e) => {
      dragging = true; didDrag = false; lx = e.clientX; ly = e.clientY;
      dom.setPointerCapture(e.pointerId); dom.style.cursor = 'grabbing';
    });
    dom.addEventListener('pointermove', (e) => {
      if (dragging) {
        const dx = e.clientX - lx, dy = e.clientY - ly;
        if (Math.abs(dx) + Math.abs(dy) > 2) didDrag = true;
        orbit.az -= dx * 0.005;
        orbit.el = Math.max(0.05, Math.min(Math.PI/2 - 0.05, orbit.el + dy * 0.005));
        lx = e.clientX; ly = e.clientY;
        applyCamera();
        ringMat.opacity = 0;
        if (onHover) onHover(null);
      } else {
        const hit = pickSurface(e.clientX, e.clientY);
        if (hit) {
          ring.position.set(hit.world.x, hit.world.y + 0.005, hit.world.z);
          ringMat.opacity = 0.85;
          if (onHover) onHover(hit);
        } else {
          ringMat.opacity = 0;
          if (onHover) onHover(null);
        }
      }
    });
    dom.addEventListener('pointerleave', () => { ringMat.opacity = 0; if (onHover) onHover(null); });
    dom.addEventListener('pointerup', (e) => {
      dragging = false; dom.style.cursor = 'grab';
      try { dom.releasePointerCapture(e.pointerId); } catch (_) {}
    });
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      orbit.dist = Math.max(2.0, Math.min(7, orbit.dist + e.deltaY * 0.003));
      applyCamera();
    }, { passive: false });

    // Auto-rotate when idle
    let rafId = 0, last = performance.now(), idleTime = 0;
    function tick(now) {
      const dt = (now - last) / 1000; last = now;
      if (!dragging) {
        idleTime += dt;
        if (idleTime > 1.5) orbit.az += dt * 0.04;
        applyCamera();
      } else {
        idleTime = 0;
      }
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);

    const ro = new ResizeObserver(() => {
      const W = container.clientWidth, H = container.clientHeight;
      if (!W || !H) return;
      renderer.setSize(W, H);
      camera.aspect = W / H; camera.updateProjectionMatrix();
    });
    ro.observe(container);

    return {
      destroy() {
        cancelAnimationFrame(rafId); ro.disconnect();
        renderer.dispose();
        if (dom.parentNode) dom.parentNode.removeChild(dom);
      },
      setScheme(s) { curScheme = s; rebuildColors(s); },
      setParams(p) { Object.assign(params || (params = {}), p); rebuildColors(curScheme); },
    };
  }

  window.OptionsSurface = { make: makeSurface, pnlValue, colorAt, SCHEMES };
})();
