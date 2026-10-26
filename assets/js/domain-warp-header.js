/*
 * Domain-warp header relief
 *
 * Draws a slowly flowing, pale "sculpted plaster" relief behind the header
 * banner, seen straight from above under a low raking light.
 *
 * Technique (written from scratch for this site):
 *   1. Height pass: a domain-warped fBm heightfield, f(p) = fbm(p + k*r),
 *      r = fbm2(p + k*q), q = fbm2(p) (Inigo Quilez, "Domain warping",
 *      https://iquilezles.org/articles/warp/), rendered into an RGBA8 texture
 *      with the height packed into two channels (16-bit precision). The
 *      texture has a margin around the visible area so shadows near the edges
 *      can still find their occluders.
 *   2. Shade pass: the height is softly terraced into rounded layers, normals
 *      come from finite differences, a short march toward the light gives soft
 *      shadows, and a ring of samples gives a cavity/occlusion term.
 *
 * Raw WebGL 1, no dependencies. Progressive enhancement: if anything is
 * missing (WebGL, a shader compile), the canvas stays transparent and the
 * CSS fallback background of .banner shows through.
 */

// Tweakable look. World units: the banner height spans `scale` units.
const CONFIG = {
    scale: 1.1,             // zoom: larger = more, smaller features
    warp: 2.4,              // domain warp strength (k above)
    contrast: 1.3,          // spread of the raw fBm height around 0.5
    flowSpeed: 0.045,       // animation speed (world units per second, roughly)
    terraces: 10.0,         // number of layers over the full height range
    terraceWidth: 0.7,      // width of the rounded step in each layer (0..1)
    terraceSlope: 0.15,     // how much of the raw slope survives on the plateaus
    depth: 0.07,            // relief depth in world units (stronger shading/shadows)
    lightAzimuth: 145,      // degrees, 0 = from the right, 90 = from the top
    lightElevation: 24,     // degrees above the horizon (low = raking light)
    shadowLength: 0.12,     // max shadow march distance in world units
    shadowSoftness: 6.0,    // higher = harder shadow edges
    ambient: 0.62,          // sky/ambient light intensity
    sun: 0.70,              // directional light intensity
    occlusion: 1.2,         // strength of the cavity/occlusion darkening
    layerTint: 0.035,       // per-layer albedo variation (subtle strata)
    albedo: [0.985, 0.98, 0.97],
    sunColor: [1.0, 0.985, 0.96],
    ambientColor: [0.90, 0.92, 0.96],
    seed: [3.7, 11.3],      // shifts the pattern
    frozenTime: 12.0,       // time used for the single frame under reduced motion
    // Performance
    maxDpr: 2,              // device pixel ratio cap
    renderScale: 0.75,      // internal resolution relative to CSS px * DPR
    maxPixels: 1000000,     // hard cap on rendered pixels per frame
    maxFps: 30,
};

const VERT = `
attribute vec2 aPos;
void main() {
    gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

const HEIGHT_FRAG = PRECISION + `
uniform vec2 uPad;       // margin of the height texture, in px
uniform float uViewH;    // visible height, in px
uniform float uScale;
uniform float uWarp;
uniform float uContrast;
uniform float uTime;
uniform vec2 uSeed;

// Gradient noise with a cheap arithmetic hash.
vec2 grad(vec2 c) {
    vec3 h = fract(vec3(c.xyx) * vec3(0.1427, 0.1731, 0.1193));
    h += dot(h, h.yzx + 31.73);
    float a = 6.2831853 * fract((h.x + h.y) * h.z);
    return vec2(cos(a), sin(a));
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = p - i;
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = dot(grad(i), f);
    float b = dot(grad(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
    float c = dot(grad(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
    float d = dot(grad(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

const mat2 ROT = mat2(1.6, 1.2, -1.2, 1.6); // rotate ~37 deg, scale 2

// Final layer: a few octaves with a low gain keeps the contours smooth.
float fbm(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        s += a * noise(p);
        p = ROT * p + vec2(7.31, 2.17);
        a *= 0.42;
    }
    return s;
}

// Warp layers: smoother still.
float fbmLow(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
        s += a * noise(p);
        p = ROT * p + vec2(3.97, 8.41);
        a *= 0.45;
    }
    return s;
}

void main() {
    vec2 p = (gl_FragCoord.xy - uPad) / uViewH * uScale + uSeed;
    float t = uTime;

    vec2 q = vec2(fbmLow(p + vec2(0.0, 0.0) + t * vec2(0.6, 0.2)),
                  fbmLow(p + vec2(5.2, 1.3) - t * vec2(0.3, 0.5)));
    vec2 r = vec2(fbmLow(p + uWarp * q + vec2(1.7, 9.2) + t * vec2(0.9, -0.4)),
                  fbmLow(p + uWarp * q + vec2(8.3, 2.8) - t * vec2(0.5, 0.8)));
    float f = fbm(p + uWarp * r);

    float h = clamp(0.5 + uContrast * f, 0.0, 0.9999);
    float hi = floor(h * 255.0);
    float lo = h * 255.0 - hi;
    gl_FragColor = vec4(hi / 255.0, lo, 0.0, 1.0);
}
`;

const SHADE_FRAG = PRECISION + `
uniform sampler2D uHeight;
uniform vec2 uTexSize;   // height texture size, in px
uniform vec2 uPad;
uniform float uTexel;    // world units per texel
uniform float uTerraces;
uniform float uTerraceWidth;
uniform float uTerraceSlope;
uniform float uDepth;
uniform vec3 uLight;     // unit vector toward the light, z up
uniform float uShadowTexels;
uniform float uShadowSoftness;
uniform float uAmbient;
uniform float uSun;
uniform float uOcclusion;
uniform float uLayerTint;
uniform vec3 uAlbedo;
uniform vec3 uSunColor;
uniform vec3 uAmbientColor;

float rawHeight(vec2 px) {
    vec4 c = texture2D(uHeight, px / uTexSize);
    return c.r + c.g / 255.0;
}

// Soft terraces: flat-ish plateaus joined by rounded steps.
float terrace(float h, out float level) {
    float x = h * uTerraces;
    level = floor(x);
    float f = x - level;
    float w = 0.5 * uTerraceWidth;
    float s = smoothstep(0.5 - w, 0.5 + w, f);
    float stepped = (level + s) / uTerraces;
    return mix(stepped, h, uTerraceSlope) * uDepth;
}

float height(vec2 px) {
    float level;
    return terrace(rawHeight(px), level);
}

void main() {
    vec2 px = gl_FragCoord.xy + uPad;

    float level;
    float h0 = terrace(rawHeight(px), level);

    // Normal from central differences.
    float hl = height(px - vec2(1.0, 0.0));
    float hr = height(px + vec2(1.0, 0.0));
    float hd = height(px - vec2(0.0, 1.0));
    float hu = height(px + vec2(0.0, 1.0));
    vec3 n = normalize(vec3((hl - hr) / (2.0 * uTexel), (hd - hu) / (2.0 * uTexel), 1.0));

    // Soft shadow: march toward the light across the heightfield.
    vec2 dir = normalize(uLight.xy);
    float tanE = uLight.z / length(uLight.xy);
    float shadow = 1.0;
    for (int i = 1; i <= 16; i++) {
        float k = float(i) / 16.0;
        float d = 1.0 + k * k * (uShadowTexels - 1.0);
        float dw = d * uTexel;
        float ray = h0 + dw * tanE;
        float hs = height(px + dir * d);
        shadow = min(shadow, uShadowSoftness * (ray - hs) / dw + 0.5);
    }
    shadow = smoothstep(0.0, 1.0, shadow);

    // Cavity / occlusion: lower than the surroundings = darker.
    float ring = 0.0;
    for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.7853982 + 0.3;
        float rad = (i < 4) ? 3.0 : 9.0;
        ring += height(px + vec2(cos(a), sin(a)) * rad);
    }
    ring /= 8.0;
    float occ = clamp(1.0 - uOcclusion * max(ring - h0, 0.0) / uDepth * uTerraces * 0.25, 0.0, 1.0);
    occ = mix(0.55, 1.0, occ);

    float diff = max(dot(n, uLight), 0.0);
    float sky = 0.75 + 0.25 * n.z;

    vec3 albedo = uAlbedo * (1.0 - uLayerTint * fract(level * 0.618034));
    vec3 light = uAmbientColor * (uAmbient * sky * occ) + uSunColor * (uSun * diff * shadow);
    vec3 col = albedo * light;

    // Gentle highlight roll-off instead of a hard clip.
    col = col / (1.0 + 0.18 * max(col - 0.85, 0.0) * 4.0);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new Error(log);
    }
    return s;
}

function program(gl, vertSrc, fragSrc) {
    const vs = compile(gl, gl.VERTEX_SHADER, vertSrc);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, "aPos");
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(p);
        gl.deleteProgram(p);
        throw new Error(log);
    }
    const uniforms = {};
    const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
        const name = gl.getActiveUniform(p, i).name;
        uniforms[name] = gl.getUniformLocation(p, name);
    }
    return { program: p, uniforms };
}

function createRenderer(canvas) {
    const gl = canvas.getContext("webgl", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: "low-power",
    });
    if (!gl) {
        return null;
    }

    const heightProg = program(gl, VERT, HEIGHT_FRAG);
    const shadeProg = program(gl, VERT, SHADE_FRAG);

    // One triangle covering the viewport.
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const az = CONFIG.lightAzimuth * Math.PI / 180;
    const el = CONFIG.lightElevation * Math.PI / 180;
    const light = [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];

    let width = 0;
    let height = 0;
    let pad = 0;
    let texW = 0;
    let texH = 0;

    function resize(w, h) {
        width = w;
        height = h;
        canvas.width = w;
        canvas.height = h;
        const texel = CONFIG.scale / h;
        pad = Math.ceil(CONFIG.shadowLength / texel) + 10;
        texW = w + 2 * pad;
        texH = h + 2 * pad;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texW, texH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        if (!ok) {
            throw new Error("framebuffer incomplete");
        }
    }

    function render(time) {
        const texel = CONFIG.scale / height;

        // Pass 1: heightfield into the texture (with margin).
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, texW, texH);
        let u = heightProg.uniforms;
        gl.useProgram(heightProg.program);
        gl.uniform2f(u.uPad, pad, pad);
        gl.uniform1f(u.uViewH, height);
        gl.uniform1f(u.uScale, CONFIG.scale);
        gl.uniform1f(u.uWarp, CONFIG.warp);
        gl.uniform1f(u.uContrast, CONFIG.contrast);
        gl.uniform1f(u.uTime, time * CONFIG.flowSpeed);
        gl.uniform2f(u.uSeed, CONFIG.seed[0], CONFIG.seed[1]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // Pass 2: shading to the canvas.
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
        u = shadeProg.uniforms;
        gl.useProgram(shadeProg.program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(u.uHeight, 0);
        gl.uniform2f(u.uTexSize, texW, texH);
        gl.uniform2f(u.uPad, pad, pad);
        gl.uniform1f(u.uTexel, texel);
        gl.uniform1f(u.uTerraces, CONFIG.terraces);
        gl.uniform1f(u.uTerraceWidth, CONFIG.terraceWidth);
        gl.uniform1f(u.uTerraceSlope, CONFIG.terraceSlope);
        gl.uniform1f(u.uDepth, CONFIG.depth);
        gl.uniform3f(u.uLight, light[0], light[1], light[2]);
        gl.uniform1f(u.uShadowTexels, CONFIG.shadowLength / texel);
        gl.uniform1f(u.uShadowSoftness, CONFIG.shadowSoftness);
        gl.uniform1f(u.uAmbient, CONFIG.ambient);
        gl.uniform1f(u.uSun, CONFIG.sun);
        gl.uniform1f(u.uOcclusion, CONFIG.occlusion);
        gl.uniform1f(u.uLayerTint, CONFIG.layerTint);
        gl.uniform3fv(u.uAlbedo, CONFIG.albedo);
        gl.uniform3fv(u.uSunColor, CONFIG.sunColor);
        gl.uniform3fv(u.uAmbientColor, CONFIG.ambientColor);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function dispose() {
        if (gl.isContextLost()) {
            return;
        }
        gl.deleteFramebuffer(fbo);
        gl.deleteTexture(tex);
        gl.deleteBuffer(quad);
        gl.deleteProgram(heightProg.program);
        gl.deleteProgram(shadeProg.program);
    }

    return { gl, resize, render, dispose };
}

function mount(canvas) {
    const banner = canvas.parentElement;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let renderer = null;
    let frame = 0;
    let lastDraw = -Infinity;
    let onScreen = true;
    let started = performance.now();
    let size = [0, 0];

    function canvasSize() {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxDpr);
        let scale = dpr * CONFIG.renderScale;
        const area = rect.width * rect.height * scale * scale;
        if (area > CONFIG.maxPixels) {
            scale *= Math.sqrt(CONFIG.maxPixels / area);
        }
        return [Math.max(1, Math.round(rect.width * scale)), Math.max(1, Math.round(rect.height * scale))];
    }

    function draw(now) {
        const [w, h] = canvasSize();
        if (w !== size[0] || h !== size[1]) {
            renderer.resize(w, h);
            size = [w, h];
        }
        const t = reducedMotion.matches ? CONFIG.frozenTime : CONFIG.frozenTime + (now - started) / 1000;
        renderer.render(t);
        canvas.classList.add("is-ready");
    }

    function tick(now) {
        frame = 0;
        if (!shouldAnimate()) {
            return;
        }
        if (now - lastDraw >= 1000 / CONFIG.maxFps - 2) {
            lastDraw = now;
            draw(now);
        }
        frame = requestAnimationFrame(tick);
    }

    function shouldAnimate() {
        return renderer && onScreen && !document.hidden && !reducedMotion.matches;
    }

    function update() {
        if (!renderer) {
            return;
        }
        if (shouldAnimate()) {
            if (!frame) {
                frame = requestAnimationFrame(tick);
            }
        } else {
            if (frame) {
                cancelAnimationFrame(frame);
                frame = 0;
            }
            // Reduced motion: keep one frozen frame, redrawn on resize.
            if (reducedMotion.matches) {
                draw(performance.now());
            }
        }
    }

    function start() {
        try {
            renderer = createRenderer(canvas);
        } catch (err) {
            renderer = null;
        }
        size = [0, 0];
        if (!renderer) {
            canvas.classList.remove("is-ready");
            return;
        }
        update();
    }

    function stop() {
        if (frame) {
            cancelAnimationFrame(frame);
            frame = 0;
        }
        if (renderer) {
            renderer.dispose();
            renderer = null;
        }
    }

    const io = new IntersectionObserver((entries) => {
        onScreen = entries[entries.length - 1].isIntersecting;
        update();
    });
    io.observe(banner);

    const ro = new ResizeObserver(() => {
        if (renderer && !frame) {
            update();
        }
    });
    ro.observe(canvas);

    const onVisibility = () => update();
    const onMotionChange = () => update();
    const onContextLost = (e) => {
        e.preventDefault();
        if (frame) {
            cancelAnimationFrame(frame);
            frame = 0;
        }
        renderer = null;
        canvas.classList.remove("is-ready");
    };
    const onContextRestored = () => start();
    const onPageHide = (e) => {
        if (!e.persisted) {
            teardown();
        } else {
            stop();
        }
    };
    const onPageShow = (e) => {
        if (e.persisted && !renderer) {
            start();
        }
    };

    document.addEventListener("visibilitychange", onVisibility);
    reducedMotion.addEventListener("change", onMotionChange);
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);

    function teardown() {
        stop();
        io.disconnect();
        ro.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        reducedMotion.removeEventListener("change", onMotionChange);
        canvas.removeEventListener("webglcontextlost", onContextLost);
        canvas.removeEventListener("webglcontextrestored", onContextRestored);
        window.removeEventListener("pagehide", onPageHide);
        window.removeEventListener("pageshow", onPageShow);
        canvas.classList.remove("is-ready");
    }

    start();
    return teardown;
}

const canvas = document.querySelector('canvas[data-effect="domain-warp"]');
if (canvas && "IntersectionObserver" in window && "ResizeObserver" in window) {
    mount(canvas);
}
