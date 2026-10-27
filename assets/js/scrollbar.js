/*
 * Overlay scrollbar
 *
 * Replaces the browser's page scrollbar with a thin, rounded rail on the
 * right (.scrollbar, styled in _sass/scrollbar.scss) that fades in while the
 * page scrolls and fades out shortly after. Hovering the rail keeps it shown;
 * the thumb can be dragged and the rail clicked to jump.
 *
 * Only for mouse/trackpad devices: touch screens already have a thin overlay
 * scrollbar that fades on its own. Without JS the native scrollbar stays
 * (html.has-scrollbar is what hides it). The rail is decorative for assistive
 * tech (aria-hidden); keyboard and wheel scrolling are the browser's own.
 */

const HIDE_DELAY = 600;     // ms without scrolling before the rail fades out
const MIN_THUMB = 24;       // px

function mount() {
    const root = document.documentElement;
    const rail = document.createElement("div");
    rail.className = "scrollbar";
    rail.setAttribute("aria-hidden", "true");
    const track = document.createElement("div");
    track.className = "scrollbar-track";
    const thumb = document.createElement("div");
    thumb.className = "scrollbar-thumb";
    track.appendChild(thumb);
    rail.appendChild(track);
    document.body.appendChild(rail);
    root.classList.add("has-scrollbar");

    let frame = 0;
    let hideTimer = 0;
    let hovered = false;
    let drag = null;    // { startY, startScroll } while the thumb is dragged
    let thumbHeight = 0;
    let travel = 0;     // px the thumb can move inside the track
    let maxScroll = 0;

    function layout() {
        frame = 0;
        const view = window.innerHeight;
        maxScroll = root.scrollHeight - view;
        rail.hidden = maxScroll <= 0;
        if (rail.hidden) {
            return;
        }
        const trackHeight = track.clientHeight;
        thumbHeight = Math.max(MIN_THUMB, trackHeight * view / root.scrollHeight);
        travel = trackHeight - thumbHeight;
        thumb.style.height = thumbHeight + "px";
        const ratio = Math.min(1, Math.max(0, window.scrollY / maxScroll));
        thumb.style.transform = "translateY(" + ratio * travel + "px)";
    }

    function schedule() {
        if (!frame) {
            frame = requestAnimationFrame(layout);
        }
    }

    function show() {
        rail.classList.add("is-visible");
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            if (!hovered && !drag) {
                rail.classList.remove("is-visible");
            }
        }, HIDE_DELAY);
    }

    // behavior "instant" skips the CSS smooth scrolling, so the page keeps up
    // with a drag; left undefined, it follows the CSS (smooth).
    function scrollToRatio(ratio, behavior) {
        window.scrollTo({ top: Math.min(1, Math.max(0, ratio)) * maxScroll, behavior: behavior });
    }

    window.addEventListener("scroll", () => {
        schedule();
        show();
    }, { passive: true });
    window.addEventListener("resize", schedule);
    new ResizeObserver(schedule).observe(document.body);

    rail.addEventListener("pointerenter", () => {
        hovered = true;
        schedule();
        show();
    });
    rail.addEventListener("pointerleave", () => {
        hovered = false;
        show();
    });

    thumb.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        thumb.setPointerCapture(e.pointerId);
        drag = { startY: e.clientY, startScroll: window.scrollY };
        rail.classList.add("is-dragging");
    });
    thumb.addEventListener("pointermove", (e) => {
        if (!drag || travel <= 0) {
            return;
        }
        const ratio = drag.startScroll / maxScroll + (e.clientY - drag.startY) / travel;
        scrollToRatio(ratio, "instant");
    });
    const endDrag = () => {
        if (!drag) {
            return;
        }
        drag = null;
        rail.classList.remove("is-dragging");
        show();
    };
    thumb.addEventListener("pointerup", endDrag);
    thumb.addEventListener("pointercancel", endDrag);

    // A click on the rail centres the thumb there (smoothly, like the nav links).
    rail.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || travel <= 0) {
            return;
        }
        e.preventDefault();
        const rect = track.getBoundingClientRect();
        scrollToRatio((e.clientY - rect.top - thumbHeight / 2) / travel);
    });

    layout();
}

if (window.matchMedia("(hover: hover) and (pointer: fine)").matches && "ResizeObserver" in window) {
    mount();
}
