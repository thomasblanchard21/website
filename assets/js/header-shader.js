// Animated shader drawn behind the site header. Pure decoration: if WebGL or
// three.js is unavailable, nothing is added and the plain theme stays as is.
import * as THREE from 'three';

const vertexShader = /* glsl */ `
    varying vec2 vUv;

    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

const fragmentShader = /* glsl */ `
    uniform float uTime;
    uniform vec2 uResolution;
    uniform vec3 uColor;
    uniform float uIntensity;
    varying vec2 vUv;

    void main() {
        vec2 p = vUv * vec2(uResolution.x / uResolution.y, 1.0);
        float t = uTime * 0.2;

        // Sum of drifting sine waves, remapped to 0..1.
        float v = sin(p.x * 2.0 + t);
        v += sin(p.y * 3.0 - t * 1.3);
        v += sin((p.x + p.y) * 2.5 + t * 0.7);
        v += sin(length(p - vec2(2.0 + 2.0 * sin(t * 0.5), cos(t * 0.3))) * 4.0 - t);
        v = v * 0.125 + 0.5;

        // Fade out towards the bottom edge so the header blends into the page.
        float alpha = uIntensity * smoothstep(0.2, 0.8, v) * smoothstep(0.0, 0.6, vUv.y);
        gl_FragColor = vec4(uColor * alpha, alpha);
    }
`;

function hasWebGL() {
    try {
        const canvas = document.createElement('canvas');
        return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    } catch (e) {
        return false;
    }
}

function init(header) {
    const style = getComputedStyle(header);
    const rgb = {};
    new THREE.Color(style.getPropertyValue('--header-shader-color').trim() || '#3d7ab8')
        .getRGB(rgb, THREE.SRGBColorSpace);
    const intensity = parseFloat(style.getPropertyValue('--header-shader-intensity')) || 0.25;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const canvas = renderer.domElement;
    canvas.className = 'header-shader';
    canvas.setAttribute('aria-hidden', 'true');
    header.prepend(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
            uTime: { value: 0 },
            uResolution: { value: new THREE.Vector2(1, 1) },
            uColor: { value: new THREE.Vector3(rgb.r, rgb.g, rgb.b) },
            uIntensity: { value: intensity },
        },
    });
    scene.add(new THREE.Mesh(geometry, material));

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let onScreen = true;
    let frame = null;
    let last = 0;

    function render() {
        renderer.render(scene, camera);
    }

    function tick(now) {
        material.uniforms.uTime.value += (now - last) / 1000;
        last = now;
        render();
        frame = requestAnimationFrame(tick);
    }

    // Animate only while the header is visible and motion is allowed.
    function update() {
        const shouldRun = onScreen && !document.hidden && !reducedMotion.matches;
        if (shouldRun && frame === null) {
            last = performance.now();
            frame = requestAnimationFrame(tick);
        } else if (!shouldRun && frame !== null) {
            cancelAnimationFrame(frame);
            frame = null;
        }
    }

    const resizeObserver = new ResizeObserver(() => {
        const width = header.clientWidth;
        const height = header.clientHeight;
        renderer.setSize(width, height, false);
        material.uniforms.uResolution.value.set(width, height);
        render();
    });
    resizeObserver.observe(header);

    const intersectionObserver = new IntersectionObserver((entries) => {
        onScreen = entries[0].isIntersecting;
        update();
    });
    intersectionObserver.observe(header);

    document.addEventListener('visibilitychange', update);
    reducedMotion.addEventListener('change', update);

    function dispose() {
        cancelAnimationFrame(frame);
        frame = null;
        resizeObserver.disconnect();
        intersectionObserver.disconnect();
        document.removeEventListener('visibilitychange', update);
        reducedMotion.removeEventListener('change', update);
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        canvas.remove();
    }

    canvas.addEventListener('webglcontextlost', dispose);
    window.addEventListener('pagehide', dispose, { once: true });
    update();
}

const header = document.querySelector('.site-header');
if (header && hasWebGL()) {
    try {
        init(header);
    } catch (e) {
        // Leave the plain theme in place.
    }
}
