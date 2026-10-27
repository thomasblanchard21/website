/*
 * Domain-warp header relief
 *
 * Draws a slowly flowing, pale "sculpted plaster" relief behind the whole
 * page (a fixed, viewport-sized canvas), seen straight from above under a
 * low raking light.
 *
 * Technique (written from scratch for this site):
 *   1. Height pass: a domain-warped fBm heightfield, f(p) = fbm(p + k*r),
 *      r = fbm2(p + k*q), q = fbm2(p) (Inigo Quilez, "Domain warping",
 *      https://iquilezles.org/articles/warp/), rendered into an RGBA8 texture
 *      with the height packed into two channels (16-bit precision). The
 *      texture has a margin around the visible area so shadows near the edges
 *      can still find their occluders.
 *      The mouse presses a smooth dip into the height there, so the
 *      layers around the cursor step down.
 *   2. Shade pass: the height is softly terraced into rounded layers, normals
 *      come from finite differences, a short march toward the light gives soft
 *      shadows, and a ring of samples gives a cavity/occlusion term.
 *
 * Raw WebGL 1, no dependencies. Progressive enhancement: if anything is
 * missing (WebGL, a shader compile), the canvas stays transparent and the
 * CSS fallback background of the page shows through.
 *
 * Performance: low-end devices start at a lower resolution and frame rate,
 * and the resolution drops further if the frame rate actually reached is too
 * low; as a last resort the relief freezes on a still frame. The
 * .relief-toggle button lets the visitor pause or play the animation (the
 * choice is kept in localStorage).
 */

// Tweakable look. World units: `referenceHeight` CSS px span `scale` units.
const CONFIG = {
    scale: 0.8,             // zoom: larger = more, smaller features
    referenceHeight: 300,   // CSS px, so the feature size doesn't depend on the viewport
    warp: 1.0,              // domain warp strength (k above)
    contrast: 2.3,          // spread of the raw fBm height around 0.5
    flowSpeed: 0.03,        // animation speed (world units per second, roughly)
    terraces: 11.0,         // number of layers over the full height range
    terraceWidth: 0.58,     // width of the rounded step in each layer (0..1)
    terraceSlope: 0.35,     // how much of the raw slope survives on the plateaus
    depth: 0.18,            // relief depth in world units (stronger shading/shadows)
    lightAzimuth: 145,      // degrees, 0 = from the right, 90 = from the top
    lightElevation: 35,     // degrees above the horizon (low = raking light)
    shadowLength: 0.09,     // max shadow march distance in world units
    shadowSoftness: 2.0,    // higher = harder shadow edges
    ambient: 0.84,          // sky/ambient light intensity
    sun: 0.52,              // directional light intensity
    volume: 0.8,            // blend of a wide-stencil normal into the diffuse (dome shading)
    volumeRadius: 16.0,     // wide-stencil radius in texels
    ringInner: 5.0,         // cavity sample radii in texels
    ringOuter: 14.0,
    occlusion: 1.2,         // strength of the cavity/occlusion darkening
    occlusionFloor: 0.78,   // darkest the occlusion term can get (0..1)
    shadowFloor: 0.55,      // how much sun still reaches shadowed areas (0..1)
    sheen: 0.15,            // strength of the broad satin specular
    sheenPower: 20.0,       // specular exponent (lower = broader)
    layerTint: 0.035,       // per-layer albedo variation (subtle strata)
    albedo: [0.975, 0.985, 0.995],
    sunColor: [1.0, 0.99, 0.97],
    ambientColor: [0.90, 0.93, 0.96],
    seed: null,             // [x, y] shifts the pattern; null picks a random one per page load
    seedRange: 20.0,        // random seeds fall in [0, seedRange); kept small for mediump GPUs
    frozenTime: 12.0,       // time used for the single frame under reduced motion
    // Mouse hover: the relief sinks around the cursor (off under reduced motion)
    hoverRadius: 0.2,       // radius of the dip in world units
    hoverDepth: 0.45,       // how far the height drops at the centre (height range is 0..1)
    hoverFollow: 8.0,       // how fast the dip follows the cursor (per second)
    hoverFade: 4.0,         // how fast the dip appears/disappears (per second)
    // Performance
    maxDpr: 2,              // device pixel ratio cap
    renderScale: 0.75,      // internal resolution relative to CSS px * DPR
    maxPixels: 1600000,     // pixel budget per frame...
    minScale: 0.75,         // ...but never render below this fraction of CSS px
    maxFps: 30,
    // Low-end devices (see isLowEnd) start with these instead
    lowEnd: { renderScale: 0.5, maxPixels: 600000, maxFps: 20 },
    // Adaptive quality: if the frame rate actually reached stays below
    // `slowRatio` of the target, the resolution drops one step; once the
    // steps run out, the relief freezes on a still frame.
    qualitySteps: [1, 0.75, 0.55],
    slowRatio: 0.6,
    sampleFrames: 40,       // frames per measurement
    warmupFrames: 15,       // frames ignored after a (re)start or a quality change
};

// Low-end hints: few cores, little memory, or data saver on. Unreported
// values count as capable; the adaptive quality catches the rest.
function isLowEnd() {
    const nav = navigator;
    return (nav.hardwareConcurrency || 8) <= 4
        || (nav.deviceMemory || 8) <= 4
        || Boolean(nav.connection && nav.connection.saveData);
}

const PERF = Object.assign(
    { renderScale: CONFIG.renderScale, maxPixels: CONFIG.maxPixels, maxFps: CONFIG.maxFps },
    isLowEnd() ? CONFIG.lowEnd : {}
);

// The visitor's choice to pause the animation, kept across visits.
const PAUSE_KEY = "relief-paused";

function loadPaused() {
    try {
        return localStorage.getItem(PAUSE_KEY) === "1";
    } catch (err) {
        return false;
    }
}

function savePaused(paused) {
    try {
        if (paused) {
            localStorage.setItem(PAUSE_KEY, "1");
        } else {
            localStorage.removeItem(PAUSE_KEY);
        }
    } catch (err) {
        // Storage blocked: the choice lasts for this page view only.
    }
}

const SEED = CONFIG.seed || [Math.random() * CONFIG.seedRange, Math.random() * CONFIG.seedRange];

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
uniform vec3 uMouse;     // xy: cursor in world units (no seed), z: dip strength 0..1
uniform float uHoverRadius;
uniform float uHoverDepth;

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
        a *= (i < 2) ? 0.42 : 0.3;
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
    vec2 pv = (gl_FragCoord.xy - uPad) / uViewH * uScale;
    vec2 p = pv + uSeed;
    float t = uTime;

    vec2 q = vec2(fbmLow(p + vec2(0.0, 0.0) + t * vec2(0.6, 0.2)),
                  fbmLow(p + vec2(5.2, 1.3) - t * vec2(0.3, 0.5)));
    vec2 r = vec2(fbmLow(p + uWarp * q + vec2(1.7, 9.2) + t * vec2(0.9, -0.4)),
                  fbmLow(p + uWarp * q + vec2(8.3, 2.8) - t * vec2(0.5, 0.8)));
    float f = fbm(p + uWarp * r);

    vec2 dm = (pv - uMouse.xy) / uHoverRadius;
    float dip = uMouse.z * exp(-dot(dm, dm));

    float h = clamp(0.5 + uContrast * f - uHoverDepth * dip, 0.0, 0.9999);
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
uniform float uOcclusionFloor;
uniform float uShadowFloor;
uniform float uSheen;
uniform float uSheenPower;
uniform float uVolume;
uniform float uRingInner;
uniform float uRingOuter;
uniform float uVolumeRadius;
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

    // Wider stencil on the un-terraced height: large-scale slope, so
    // lobes read as rounded domes.
    float rw = uVolumeRadius;
    float wl = rawHeight(px - vec2(rw, 0.0)) * uDepth;
    float wr = rawHeight(px + vec2(rw, 0.0)) * uDepth;
    float wd = rawHeight(px - vec2(0.0, rw)) * uDepth;
    float wu = rawHeight(px + vec2(0.0, rw)) * uDepth;
    vec3 nWide = normalize(vec3((wl - wr) / (2.0 * rw * uTexel), (wd - wu) / (2.0 * rw * uTexel), 1.0));
    vec3 nDiff = normalize(mix(n, nWide, uVolume));

    // Soft shadow: march toward the light across the heightfield.
    vec2 dir = normalize(uLight.xy);
    float tanE = uLight.z / length(uLight.xy);
    // Evenly spaced samples, start jittered per pixel to avoid banding.
    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    float shadow = 1.0;
    for (int i = 0; i < 16; i++) {
        float k = (float(i) + jitter) / 16.0;
        float d = max(1.0, k * uShadowTexels);
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
        float rad = (i < 4) ? uRingInner : uRingOuter;
        ring += height(px + vec2(cos(a), sin(a)) * rad);
    }
    ring /= 8.0;
    float occ = clamp(1.0 - uOcclusion * max(ring - h0, 0.0) / uDepth * uTerraces * 0.25, 0.0, 1.0);
    occ = mix(uOcclusionFloor, 1.0, occ);

    float diff = max(dot(nDiff, uLight), 0.0);
    float sky = 0.75 + 0.25 * n.z;

    vec3 albedo = uAlbedo * (1.0 - uLayerTint * fract(level * 0.618034));
    float sunVis = mix(uShadowFloor, 1.0, shadow);
    vec3 light = uAmbientColor * (uAmbient * sky * occ) + uSunColor * (uSun * diff * sunVis);
    vec3 col = albedo * light;

    // Broad satin sheen, viewed straight down.
    vec3 hv = normalize(uLight + vec3(0.0, 0.0, 1.0));
    col += uSunColor * (uSheen * pow(max(dot(n, hv), 0.0), uSheenPower) * shadow);

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
    let worldH = CONFIG.scale;

    // w, h: canvas size in px; viewH: world units spanned by the canvas height.
    function resize(w, h, viewH) {
        width = w;
        height = h;
        canvas.width = w;
        canvas.height = h;
        worldH = viewH;
        const texel = worldH / h;
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

    function render(time, mouse) {
        const texel = worldH / height;

        // Pass 1: heightfield into the texture (with margin).
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, texW, texH);
        let u = heightProg.uniforms;
        gl.useProgram(heightProg.program);
        gl.uniform2f(u.uPad, pad, pad);
        gl.uniform1f(u.uViewH, height);
        gl.uniform1f(u.uScale, worldH);
        gl.uniform1f(u.uWarp, CONFIG.warp);
        gl.uniform1f(u.uContrast, CONFIG.contrast);
        gl.uniform1f(u.uTime, time * CONFIG.flowSpeed);
        gl.uniform2f(u.uSeed, SEED[0], SEED[1]);
        gl.uniform3f(u.uMouse, mouse.x * worldH, mouse.y * worldH, mouse.strength);
        gl.uniform1f(u.uHoverRadius, CONFIG.hoverRadius);
        gl.uniform1f(u.uHoverDepth, CONFIG.hoverDepth);
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
        gl.uniform1f(u.uOcclusionFloor, CONFIG.occlusionFloor);
        gl.uniform1f(u.uShadowFloor, CONFIG.shadowFloor);
        gl.uniform1f(u.uSheen, CONFIG.sheen);
        gl.uniform1f(u.uSheenPower, CONFIG.sheenPower);
        gl.uniform1f(u.uVolume, CONFIG.volume);
        gl.uniform1f(u.uRingInner, CONFIG.ringInner);
        gl.uniform1f(u.uRingOuter, CONFIG.ringOuter);
        gl.uniform1f(u.uVolumeRadius, CONFIG.volumeRadius);
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

function mount(canvas, toggle) {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let renderer = null;
    let frame = 0;
    let lastDraw = -Infinity;
    let onScreen = true;
    // Animation clock in ms; it only runs while the relief is animated, so a
    // pause resumes where it stopped.
    let elapsed = 0;
    let size = [0, 0, 0];
    // Paused by the visitor (toggle button), or because the device is too slow.
    let paused = loadPaused();
    let tooSlow = false;
    // Off once the visitor plays the animation again after it was found too slow.
    let adaptive = true;
    // Adaptive quality: index into CONFIG.qualitySteps, and the current measurement.
    let quality = 0;
    let sampleCount = 0;
    let sampleTime = 0;
    // Cursor position in canvas-height units, origin bottom-left (like gl_FragCoord).
    const pointer = { x: 0, y: 0, inside: false };
    const mouse = { x: 0, y: 0, strength: 0 };
    let lastMouseUpdate = 0;

    function canvasSize() {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxDpr);
        const step = CONFIG.qualitySteps[quality];
        let scale = dpr * PERF.renderScale * step;
        const area = rect.width * rect.height * scale * scale;
        const maxPixels = PERF.maxPixels * step * step;
        if (area > maxPixels) {
            scale = Math.max(scale * Math.sqrt(maxPixels / area), Math.min(scale, CONFIG.minScale * step));
        }
        return [
            Math.max(1, Math.round(rect.width * scale)),
            Math.max(1, Math.round(rect.height * scale)),
            CONFIG.scale * rect.height / CONFIG.referenceHeight,
        ];
    }

    function draw(now) {
        const [w, h, viewH] = canvasSize();
        if (w !== size[0] || h !== size[1] || viewH !== size[2]) {
            renderer.resize(w, h, viewH);
            size = [w, h, viewH];
        }
        const t = CONFIG.frozenTime + (reducedMotion.matches ? 0 : elapsed / 1000);
        updateMouse(now);
        renderer.render(t, mouse);
        canvas.classList.add("is-ready");
    }

    // Still frame (paused, too slow, or reduced motion): no hover dip, since
    // it would need redrawing as the cursor moves.
    function drawStill() {
        pointer.inside = false;
        mouse.strength = 0;
        draw(performance.now());
    }

    function restartMeasure() {
        sampleCount = -CONFIG.warmupFrames;
        sampleTime = 0;
    }

    // interval: ms since the previous drawn frame.
    function measure(interval) {
        if (!adaptive) {
            return;
        }
        sampleCount++;
        if (sampleCount <= 0) {
            return;
        }
        sampleTime += interval;
        if (sampleCount < CONFIG.sampleFrames) {
            return;
        }
        const fps = 1000 * sampleCount / sampleTime;
        restartMeasure();
        if (fps >= PERF.maxFps * CONFIG.slowRatio) {
            return;
        }
        if (quality < CONFIG.qualitySteps.length - 1) {
            quality++;
        } else {
            tooSlow = true;
            syncToggle();
        }
    }

    function updateMouse(now) {
        const dt = Math.min((now - lastMouseUpdate) / 1000, 0.1);
        lastMouseUpdate = now;
        const target = pointer.inside && !reducedMotion.matches ? 1 : 0;
        if (mouse.strength === 0 && target) {
            // Appear where the cursor is instead of sliding in from elsewhere.
            mouse.x = pointer.x;
            mouse.y = pointer.y;
        }
        const follow = 1 - Math.exp(-CONFIG.hoverFollow * dt);
        mouse.x += (pointer.x - mouse.x) * follow;
        mouse.y += (pointer.y - mouse.y) * follow;
        mouse.strength += (target - mouse.strength) * (1 - Math.exp(-CONFIG.hoverFade * dt));
        if (mouse.strength < 0.001 && !target) {
            mouse.strength = 0;
        }
    }

    function tick(now) {
        frame = 0;
        if (!shouldAnimate()) {
            return;
        }
        const interval = now - lastDraw;
        if (interval >= 1000 / PERF.maxFps - 2) {
            lastDraw = now;
            // A long gap (first frame, hiccup) neither moves the clock much nor counts as slow.
            if (interval < 250) {
                elapsed += interval;
                measure(interval);
            } else {
                elapsed += 1000 / PERF.maxFps;
                restartMeasure();
            }
            draw(now);
        }
        if (!shouldAnimate()) {
            // Found too slow just now: keep this frame, without the hover dip.
            drawStill();
            return;
        }
        frame = requestAnimationFrame(tick);
    }

    function isFrozen() {
        return reducedMotion.matches || paused || tooSlow;
    }

    function shouldAnimate() {
        return renderer && onScreen && !document.hidden && !isFrozen();
    }

    // The button is offered whenever the relief could move: not without
    // WebGL, nor under reduced motion where it stays still anyway.
    function syncToggle() {
        if (!toggle) {
            return;
        }
        const frozen = paused || tooSlow;
        toggle.hidden = !renderer || reducedMotion.matches;
        toggle.classList.toggle("is-paused", frozen);
        const label = frozen ? "Play background animation" : "Pause background animation";
        toggle.setAttribute("aria-label", label);
        toggle.title = label;
    }

    const onToggle = () => {
        if (paused || tooSlow) {
            if (tooSlow) {
                // Playing again overrides the slowness check for this page view.
                tooSlow = false;
                adaptive = false;
            }
            paused = false;
        } else {
            paused = true;
        }
        savePaused(paused);
        syncToggle();
        update();
    };

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
            // Paused, too slow or reduced motion: keep one still frame, redrawn on resize.
            if (isFrozen()) {
                drawStill();
            }
        }
    }

    function start() {
        try {
            renderer = createRenderer(canvas);
        } catch (err) {
            renderer = null;
        }
        size = [0, 0, 0];
        restartMeasure();
        syncToggle();
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
    io.observe(canvas);

    const ro = new ResizeObserver(() => {
        if (renderer && !frame) {
            update();
        }
    });
    ro.observe(canvas);

    const onPointerMove = (e) => {
        // Mouse and pen only: a touch has no hover and would leave a stray dip.
        if (e.pointerType === "touch") {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        pointer.x = (e.clientX - rect.left) / rect.height;
        pointer.y = (rect.bottom - e.clientY) / rect.height;
        pointer.inside = true;
    };
    const onPointerLeave = () => {
        pointer.inside = false;
    };

    const onVisibility = () => update();
    const onMotionChange = () => {
        syncToggle();
        update();
    };
    const onContextLost = (e) => {
        e.preventDefault();
        if (frame) {
            cancelAnimationFrame(frame);
            frame = 0;
        }
        renderer = null;
        canvas.classList.remove("is-ready");
        syncToggle();
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

    document.addEventListener("pointermove", onPointerMove);
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibility);
    reducedMotion.addEventListener("change", onMotionChange);
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    if (toggle) {
        toggle.addEventListener("click", onToggle);
    }

    function teardown() {
        stop();
        io.disconnect();
        ro.disconnect();
        document.removeEventListener("pointermove", onPointerMove);
        document.documentElement.removeEventListener("pointerleave", onPointerLeave);
        document.removeEventListener("visibilitychange", onVisibility);
        reducedMotion.removeEventListener("change", onMotionChange);
        canvas.removeEventListener("webglcontextlost", onContextLost);
        canvas.removeEventListener("webglcontextrestored", onContextRestored);
        window.removeEventListener("pagehide", onPageHide);
        window.removeEventListener("pageshow", onPageShow);
        if (toggle) {
            toggle.removeEventListener("click", onToggle);
            toggle.hidden = true;
        }
        canvas.classList.remove("is-ready");
    }

    start();
    return teardown;
}

const canvas = document.querySelector('canvas[data-effect="domain-warp"]');
if (canvas && "IntersectionObserver" in window && "ResizeObserver" in window) {
    mount(canvas, document.querySelector(".relief-toggle"));
}
