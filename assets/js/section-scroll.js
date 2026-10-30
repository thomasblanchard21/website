/*
 * Section scrolling
 *
 * The page snaps from one section panel to the next (CSS scroll snap, see
 * _sass/panels.scss), which on its own moves a whole section per wheel
 * notch. Here the wheel has to travel THRESHOLD px in one direction (with
 * pauses shorter than RESET) before the page moves on to the next section;
 * less does nothing. Inside
 * a section taller than the window, the wheel scrolls it as usual but stops
 * at its edge (left alone, the browser's snapping would jump on to the next
 * section when a scroll overshoots the edge), and leaving it takes a new
 * gesture. After a move, the rest of the gesture (trackpad momentum) is
 * ignored.
 *
 * Also sets --footer-height on <html>, which the CSS uses to fit the footer
 * into the last screen. Touch and keyboard scrolling keep the native
 * snapping. Without JS the CSS fallbacks apply.
 */

const THRESHOLD = 160;  // px of wheel travel to change section (a notch is ~100)
const QUIET = 200;      // ms without wheel events that ends a gesture
const RESET = 800;      // ms without wheel events that resets the travel count
const LINE = 40;        // px per line, for wheel events counted in lines

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

function mount(panels) {
    let sum = 0;            // wheel travel towards the next section
    let last = -Infinity;   // time of the previous wheel event
    let lastDir = 0;        // direction of the previous wheel event
    let target = 0;         // where the native scrolling of the gesture is heading
    let moving = false;     // true from a section change to the end of its gesture
    let inside = false;     // the current gesture scrolled inside a tall section
    let scrolling = false;  // true while the page scrolls to a section

    function onScrollEnd() {
        scrolling = false;
    }
    window.addEventListener("scrollend", onScrollEnd);

    function go(y) {
        moving = true;
        scrolling = true;
        window.scrollTo({ top: y });
        if (!("onscrollend" in window)) {
            setTimeout(onScrollEnd, 800);
        }
    }

    window.addEventListener("wheel", (e) => {
        if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.deltaY === 0) {
            return; // pinch zoom, sideways scroll
        }
        const dir = Math.sign(e.deltaY);
        const delta = e.deltaY * (e.deltaMode === 1 ? LINE : e.deltaMode === 2 ? window.innerHeight : 1);
        const y = window.scrollY;
        const gap = e.timeStamp - last;
        const turned = dir !== lastDir;
        last = e.timeStamp;
        lastDir = dir;
        if (moving) {
            if (scrolling || gap < QUIET) {
                e.preventDefault();
                return;
            }
            moving = false;
        }
        if (gap > RESET || turned) {
            sum = 0;
        }
        if (gap > QUIET || turned) {
            inside = false;
            target = y;
        }

        const list = screens(panels);
        // The current screen: the one whose range is closest to the scroll position.
        let i = 0;
        let best = Infinity;
        list.forEach(([lo, hi], k) => {
            const d = y < lo ? lo - y : y > hi ? y - hi : 0;
            if (d < best) {
                best = d;
                i = k;
            }
        });
        const [lo, hi] = list[i];
        // The page may still be on its way to where earlier events sent it.
        const from = dir > 0 ? Math.max(target, y) : Math.min(target, y);
        if ((dir > 0 && from < hi - 1) || (dir < 0 && from > lo + 1)) {
            // Inside a tall section: scroll it natively, up to its edge.
            sum = 0;
            inside = true;
            target = from + delta;
            if (target > hi || target < lo) {
                e.preventDefault();
                target = dir > 0 ? hi : lo;
                window.scrollTo({ top: target });
            }
            return;
        }

        e.preventDefault();
        const next = list[i + dir];
        if (!next || inside) {
            return;
        }
        sum += delta;
        if (Math.abs(sum) >= THRESHOLD) {
            sum = 0;
            go(dir > 0 ? next[0] : next[1]);
        }
    }, { passive: false });
}

const footer = document.querySelector(".site-footer");
if (footer && "ResizeObserver" in window) {
    measureFooter(footer);
}
const panels = Array.from(document.querySelectorAll(".content > section.panel"));
if (panels.length > 1) {
    mount(panels);
}
