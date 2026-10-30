/*
 * Section scrolling
 *
 * Moves through the section panels of index.md (one per screen, see
 * _sass/panels.scss) with the mouse wheel, trackpad and keyboard. Inside a
 * section taller than the window, scrolling moves through it as usual. The
 * edge of a section pushes back: scrolling into it builds up a pressure that
 * leaks away over time, and the page moves on to the next section, landing
 * on its top, once the pressure reaches BREAK. A gentle scroll stops at the
 * edge; a hard one goes through, over several sections if it keeps going.
 * Arrow keys push like wheel notches; Page Up/Down and Space scroll a page,
 * stopping at the edge of a tall section, and move on from the edge.
 *
 * The scrolling is animated here (the browser's own is cancelled), easing
 * towards a target, with the CSS scroll snapping off meanwhile. Under
 * reduced motion the page jumps instead. Touch scrolling keeps the native
 * snapping, and so does everything without JS.
 *
 * Also sets --footer-height on <html>, which the CSS uses to fit the footer
 * into the last screen.
 */

const BREAK = 180;      // px of pressure that takes the page past a section edge (a wheel notch is ~100)
const LEAK = 500;       // ms for the pressure to leak down to about a third
const GLIDE = 90;       // ms, time constant of the scrolling animation
const LINE = 40;        // px per line, for wheel events counted in lines
const ARROW = 100;      // px per arrow key press, like a wheel notch
const PAGE = 0.85;      // Page Up/Down and Space, as a fraction of the window height

function measureFooter(footer) {
    const set = () => {
        document.documentElement.style.setProperty("--footer-height", footer.offsetHeight + "px");
    };
    new ResizeObserver(set).observe(footer);
    set();
}

// Scroll positions [lo, hi] at which each panel's snap area fills the window
// (lo === hi unless the panel is taller than the window).
function screens(panels) {
    const view = window.innerHeight;
    const max = document.documentElement.scrollHeight - view;
    return panels.map((panel) => {
        const rect = panel.getBoundingClientRect();
        const style = getComputedStyle(panel);
        const top = rect.top + window.scrollY - parseFloat(style.scrollMarginTop);
        const bottom = rect.bottom + window.scrollY + parseFloat(style.scrollMarginBottom);
        const clamp = (y) => Math.min(max, Math.max(0, Math.round(y)));
        if (bottom - top <= view) {
            const y = clamp((top + bottom - view) / 2);
            return [y, y];
        }
        return [clamp(top), clamp(bottom - view)];
    });
}

// The screen whose range is closest to scroll position y.
function closest(list, y) {
    let index = 0;
    let best = Infinity;
    list.forEach(([lo, hi], k) => {
        const d = y < lo ? lo - y : y > hi ? y - hi : 0;
        if (d < best) {
            best = d;
            index = k;
        }
    });
    return index;
}

function mount(panels) {
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let target = null;      // where the animation is heading, null when idle
    let pos = 0;            // animated scroll position
    let applied = 0;        // scroll position after the previous frame
    let frame = 0;
    let time = 0;           // time of the previous animation frame
    let pressure = 0;       // px pushed against the current section edge
    let pressureDir = 0;
    let pressureTime = 0;

    function stop() {
        cancelAnimationFrame(frame);
        frame = 0;
        target = null;
        root.style.scrollSnapType = "";
    }

    function step(now) {
        if (Math.abs(window.scrollY - applied) > 2) {
            stop(); // something else scrolled the page (a link, touch)
            return;
        }
        // (A frame's timestamp may be older than the start of the animation.)
        pos += (target - pos) * (1 - Math.exp(-Math.max(0, now - time) / GLIDE));
        time = Math.max(time, now);
        if (Math.abs(target - pos) < 0.5) {
            window.scrollTo({ top: target, behavior: "instant" });
            stop();
            return;
        }
        window.scrollTo({ top: pos, behavior: "instant" });
        applied = window.scrollY;
        frame = requestAnimationFrame(step);
    }

    function scrollTo(y) {
        if (reduced.matches) {
            window.scrollTo({ top: y, behavior: "instant" });
            return;
        }
        root.style.scrollSnapType = "none";
        if (!frame) {
            pos = window.scrollY;
            applied = pos;
            time = performance.now();
            frame = requestAnimationFrame(step);
        }
        target = y;
    }

    // Scroll by delta px. stopAtEdge: a scroll that moved inside a tall
    // section stops at its edge instead of pushing on it.
    function push(delta, stopAtEdge) {
        const dir = Math.sign(delta);
        const now = performance.now();
        pressure = dir === pressureDir ? pressure * Math.exp(-(now - pressureTime) / LEAK) : 0;
        pressureDir = dir;
        pressureTime = now;

        const list = screens(panels);
        let y = target === null ? window.scrollY : target;
        let i = closest(list, y);
        const [lo, hi] = list[i];
        // (Less than 2px of room is the edge: the page may settle a pixel short.)
        const room = Math.max(0, dir > 0 ? hi - y : y - lo);
        let rest = Math.abs(delta);
        if (room >= 2) {
            const moved = Math.min(rest, room);
            y += dir * moved;
            rest = stopAtEdge ? 0 : rest - moved;
            pressure = 0;
        }
        pressure += rest;
        if (pressure >= BREAK && list[i + dir]) {
            i += dir;
            y = list[i][0];
            pressure = 0;
        }
        scrollTo(y);
    }

    window.addEventListener("wheel", (e) => {
        if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.deltaY === 0) {
            return; // pinch zoom, sideways scroll
        }
        e.preventDefault();
        push(e.deltaY * (e.deltaMode === 1 ? LINE : e.deltaMode === 2 ? window.innerHeight : 1), false);
    }, { passive: false });

    window.addEventListener("keydown", (e) => {
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) {
            return;
        }
        const el = document.activeElement;
        if (el && (el.isContentEditable || el.closest("input, textarea, select, button"))) {
            return; // keys that belong to the focused control
        }
        const page = window.innerHeight * PAGE;
        switch (e.key) {
            case "ArrowDown":
                push(ARROW, false);
                break;
            case "ArrowUp":
                push(-ARROW, false);
                break;
            case "PageDown":
                push(page, true);
                break;
            case "PageUp":
                push(-page, true);
                break;
            case " ":
                push(e.shiftKey ? -page : page, true);
                break;
            case "Home":
                pressure = 0;
                scrollTo(0);
                break;
            case "End":
                pressure = 0;
                scrollTo(root.scrollHeight - window.innerHeight);
                break;
            default:
                return;
        }
        e.preventDefault();
    });
}

const footer = document.querySelector(".site-footer");
if (footer && "ResizeObserver" in window) {
    measureFooter(footer);
}
const panels = Array.from(document.querySelectorAll(".content > section.panel"));
if (panels.length > 1) {
    mount(panels);
}
