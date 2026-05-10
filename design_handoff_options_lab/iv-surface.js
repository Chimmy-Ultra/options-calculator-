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

  function makeIVSurface({ container, segments = 70 }) {
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
    const pos = geom.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / (size/2);
      const z = pos.getZ(i) / (size/2);
      const t01 = (z + 1) / 2;
      const v = ivValue(x, t01);
      pos.setY(i, (v - 0.18) * 4);
      const c = ivColor(v);
      colors[i*3] = c.r; colors[i*3+1] = c.g; colors[i*3+2] = c.b;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.computeVertexNormals();

    const mat = new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.4, metalness: 0.12, clearcoat: 0.7,
      clearcoatRoughness: 0.22, side: THREE.DoubleSide, opacity: 0.97, transparent: true,
      emissive: new THREE.Color(0x191b28), emissiveIntensity: 0.3,
    });
    scene.add(new THREE.Mesh(geom, mat));

    const wireGeom = new THREE.WireframeGeometry(geom);
    const wire = new THREE.LineSegments(wireGeom, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.10 }));
    scene.add(wire);

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

    [
      { y: 0.88, t: '40%' }, { y: 0.44, t: '29%' }, { y: 0, t: '18%' },
    ].forEach(({ y, t }) => {
      const s = makeLabel(t, axColor); s.position.set(-1.05, y, -1); s.scale.set(0.4, 0.1, 1); scene.add(s);
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1,y,-1), new THREE.Vector3(-0.94,y,-1)]);
      scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xaab4c2, transparent: true, opacity: 0.4 })));
    });

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
    const dom = renderer.domElement; dom.style.cursor = 'grab';
    dom.style.touchAction = 'none';
    const isTouch = !window.matchMedia || !window.matchMedia('(hover: hover)').matches;
    const rotSens = isTouch ? 0.012 : 0.005;
    dom.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; dom.setPointerCapture(e.pointerId); dom.style.cursor='grabbing'; });
    dom.addEventListener('pointermove', (e) => {
      if (!drag) return;
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
      if (!drag) { idle += dt; if (!isTouch && idle > 1.5) orbit.az += dt * 0.04; applyCam(); } else idle = 0;
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
    return { destroy() { cancelAnimationFrame(raf); ro.disconnect(); if (io) io.disconnect(); renderer.dispose(); if(dom.parentNode) dom.parentNode.removeChild(dom); } };
  }

  window.IVSurface3D = { make: makeIVSurface };
})();
