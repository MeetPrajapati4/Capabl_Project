import { useEffect, useRef, useState } from 'react';
import { Renderer, Camera, Transform, Geometry, Program, Mesh, Color } from 'ogl';

/**
 * 3D Web Experience: KnowledgeSpace3D
 * 
 * An interactive, lightweight 3D WebGL knowledge constellation rendered
 * in true 3D perspective space with mouse parallax, depth attenuation,
 * and orbital harmonics designed for PhD-level academic research tools.
 */
export default function KnowledgeSpace3D({ theme = 'dark' }) {
  const containerRef = useRef(null);
  const [webGLSupported, setWebGLSupported] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Mobile & capability detection for 3D performance budget
    const isMobile = /iPhone|iPad|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isLight = theme === 'light';

    // Particle budget based on device class
    const nodeCount = isMobile ? 60 : 130;
    const maxConnections = isMobile ? 80 : 200;
    const connectionDist = isMobile ? 2.0 : 2.4;

    let renderer;
    try {
      renderer = new Renderer({
        alpha: true,
        premultipliedAlpha: false,
        antialias: !isMobile,
        dpr: isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 1.5),
        powerPreference: 'high-performance'
      });
    } catch (e) {
      console.warn('WebGL not supported for 3D KnowledgeSpace:', e);
      setWebGLSupported(false);
      return;
    }

    const gl = renderer.gl;
    if (!gl) {
      setWebGLSupported(false);
      return;
    }

    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // 3D Scene Graph
    const scene = new Transform();
    const camera = new Camera(gl, { fov: 45, near: 0.1, far: 50 });
    camera.position.set(0, 0, 11);

    // Dynamic mouse parallax tracking with smooth lerp damping
    const mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
    function handleMouseMove(e) {
      if (prefersReducedMotion) return;
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = -(e.clientY / window.innerHeight) * 2 + 1;
      mouse.targetX = nx * 1.8;
      mouse.targetY = ny * 1.2;
    }
    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    // Node data generation in 3D coordinate volume
    const positions = new Float32Array(nodeCount * 3);
    const velocities = [];
    const sizes = new Float32Array(nodeCount);

    for (let i = 0; i < nodeCount; i++) {
      // Distribution in a slightly flattened 3D ellipsoid
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = Math.cbrt(Math.random()) * 5.2 + 0.8;

      positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = (r * Math.sin(phi) * Math.sin(theta)) * 0.65;
      positions[i * 3 + 2] = (r * Math.cos(phi)) * 0.85;

      velocities.push({
        vx: (Math.random() - 0.5) * 0.003,
        vy: (Math.random() - 0.5) * 0.003,
        vz: (Math.random() - 0.5) * 0.003,
        pulseSpeed: 0.02 + Math.random() * 0.03,
        pulsePhase: Math.random() * Math.PI * 2
      });

      sizes[i] = 4.0 + Math.random() * 4.5;
    }

    // Node Point Shaders
    const pointVertexShader = /* glsl */ `
      attribute vec3 position;
      attribute float size;
      uniform mat4 modelViewMatrix;
      uniform mat4 projectionMatrix;
      uniform float uTime;
      varying float vDist;

      void main() {
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPos;
        
        // 3D perspective size attenuation
        float perspectiveFactor = 12.0 / (-mvPos.z);
        gl_PointSize = size * clamp(perspectiveFactor, 0.4, 2.5);
        vDist = clamp((-mvPos.z - 4.0) / 12.0, 0.0, 1.0);
      }
    `;

    const pointFragmentShader = /* glsl */ `
      precision highp float;
      uniform vec3 uColorPrimary;
      uniform vec3 uColorSecondary;
      uniform float uOpacity;
      varying float vDist;

      void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        float dist = length(coord);
        if (dist > 0.5) discard;

        // Anti-aliased soft circular halo
        float alpha = smoothstep(0.5, 0.05, dist);
        vec3 color = mix(uColorPrimary, uColorSecondary, vDist);
        gl_FragColor = vec4(color, alpha * uOpacity * (1.0 - vDist * 0.55));
      }
    `;

    const primaryColor = isLight ? new Color('#4f46e5') : new Color('#6366f1');
    const secondaryColor = isLight ? new Color('#0284c7') : new Color('#06b6d4');

    const pointGeometry = new Geometry(gl, {
      position: { size: 3, data: positions },
      size: { size: 1, data: sizes }
    });

    const pointProgram = new Program(gl, {
      vertex: pointVertexShader,
      fragment: pointFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uColorPrimary: { value: [primaryColor.r, primaryColor.g, primaryColor.b] },
        uColorSecondary: { value: [secondaryColor.r, secondaryColor.g, secondaryColor.b] },
        uOpacity: { value: isLight ? 0.35 : 0.65 }
      },
      transparent: true,
      depthTest: false
    });

    const pointMesh = new Mesh(gl, { geometry: pointGeometry, program: pointProgram, mode: gl.POINTS });
    pointMesh.setParent(scene);

    // 3D Filament / Lines Geometry for Knowledge Connections
    const linePositions = new Float32Array(maxConnections * 6);
    const lineAlphas = new Float32Array(maxConnections * 2);

    const lineVertexShader = /* glsl */ `
      attribute vec3 position;
      attribute float alpha;
      uniform mat4 modelViewMatrix;
      uniform mat4 projectionMatrix;
      varying float vAlpha;

      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vAlpha = alpha;
      }
    `;

    const lineFragmentShader = /* glsl */ `
      precision highp float;
      uniform vec3 uLineColor;
      uniform float uBaseAlpha;
      varying float vAlpha;

      void main() {
        gl_FragColor = vec4(uLineColor, vAlpha * uBaseAlpha);
      }
    `;

    const lineGeometry = new Geometry(gl, {
      position: { size: 3, data: linePositions },
      alpha: { size: 1, data: lineAlphas }
    });

    const lineProgram = new Program(gl, {
      vertex: lineVertexShader,
      fragment: lineFragmentShader,
      uniforms: {
        uLineColor: { value: [primaryColor.r, primaryColor.g, primaryColor.b] },
        uBaseAlpha: { value: isLight ? 0.18 : 0.28 }
      },
      transparent: true,
      depthTest: false
    });

    const lineMesh = new Mesh(gl, { geometry: lineGeometry, program: lineProgram, mode: gl.LINES });
    lineMesh.setParent(scene);

    // Canvas attachment
    gl.canvas.style.position = 'absolute';
    gl.canvas.style.top = '0';
    gl.canvas.style.left = '0';
    gl.canvas.style.width = '100%';
    gl.canvas.style.height = '100%';
    gl.canvas.style.pointerEvents = 'none';
    container.appendChild(gl.canvas);

    // Resize observer
    function handleResize() {
      if (!container || !renderer) return;
      const width = container.offsetWidth || window.innerWidth;
      const height = container.offsetHeight || window.innerHeight;
      renderer.setSize(width, height);
      camera.perspective({ aspect: width / height });
    }
    window.addEventListener('resize', handleResize);
    handleResize();

    // Visibility-aware RAF loop
    let animationFrameId = null;
    let clock = 0;
    let isTabVisible = !document.hidden;

    function handleVisibilityChange() {
      isTabVisible = !document.hidden;
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    function animate() {
      animationFrameId = requestAnimationFrame(animate);
      if (!isTabVisible) return;

      clock += 0.016;

      // Smooth camera parallax inertia
      mouse.x += (mouse.targetX - mouse.x) * 0.045;
      mouse.y += (mouse.targetY - mouse.y) * 0.045;

      camera.position.x = mouse.x * 1.2;
      camera.position.y = mouse.y * 0.9;
      camera.position.z = 11 + Math.sin(clock * 0.4) * 0.35;
      camera.lookAt([0, 0, 0]);

      // Subtle celestial rotation of node lattice
      const orbitSpeed = prefersReducedMotion ? 0.0005 : 0.002;
      scene.rotation.y = clock * orbitSpeed;
      scene.rotation.x = Math.sin(clock * 0.15) * 0.05;

      // Update node positions and compute connection lines
      let connectionCount = 0;
      const posAttr = pointGeometry.attributes.position.data;

      for (let i = 0; i < nodeCount; i++) {
        const vel = velocities[i];
        posAttr[i * 3 + 0] += vel.vx;
        posAttr[i * 3 + 1] += vel.vy;
        posAttr[i * 3 + 2] += vel.vz;

        // Soft containment boundary
        const distSq = posAttr[i * 3] * posAttr[i * 3] + posAttr[i * 3 + 1] * posAttr[i * 3 + 1] + posAttr[i * 3 + 2] * posAttr[i * 3 + 2];
        if (distSq > 38.0) {
          vel.vx *= -0.95;
          vel.vy *= -0.95;
          vel.vz *= -0.95;
        }

        // Connect nearby nodes into neural filaments
        if (connectionCount < maxConnections) {
          for (let j = i + 1; j < nodeCount; j++) {
            if (connectionCount >= maxConnections) break;
            const dx = posAttr[i * 3] - posAttr[j * 3];
            const dy = posAttr[i * 3 + 1] - posAttr[j * 3 + 1];
            const dz = posAttr[i * 3 + 2] - posAttr[j * 3 + 2];
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (d < connectionDist) {
              const alphaFactor = 1.0 - d / connectionDist;
              const idx = connectionCount * 6;
              const alphaIdx = connectionCount * 2;

              linePositions[idx + 0] = posAttr[i * 3];
              linePositions[idx + 1] = posAttr[i * 3 + 1];
              linePositions[idx + 2] = posAttr[i * 3 + 2];

              linePositions[idx + 3] = posAttr[j * 3];
              linePositions[idx + 4] = posAttr[j * 3 + 1];
              linePositions[idx + 5] = posAttr[j * 3 + 2];

              lineAlphas[alphaIdx + 0] = alphaFactor;
              lineAlphas[alphaIdx + 1] = alphaFactor;

              connectionCount++;
            }
          }
        }
      }

      // Flag geometry buffer updates
      pointGeometry.attributes.position.needsUpdate = true;
      lineGeometry.attributes.position.needsUpdate = true;
      lineGeometry.attributes.alpha.needsUpdate = true;
      lineGeometry.drawRange.count = connectionCount * 2;

      renderer.render({ scene, camera });
    }

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (container && gl.canvas.parentNode === container) {
        container.removeChild(gl.canvas);
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [theme]);

  if (!webGLSupported) {
    return (
      <div 
        className="knowledge-space-3d-fallback" 
        style={{
          position: 'absolute',
          inset: 0,
          background: theme === 'light' 
            ? 'radial-gradient(circle at 50% 50%, rgba(99, 102, 241, 0.08) 0%, transparent 70%)'
            : 'radial-gradient(circle at 50% 50%, rgba(99, 102, 241, 0.12) 0%, transparent 70%)',
          pointerEvents: 'none'
        }}
      />
    );
  }

  return (
    <div 
      ref={containerRef} 
      className="knowledge-space-3d-container"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1,
        overflow: 'hidden'
      }}
      aria-hidden="true"
    />
  );
}
