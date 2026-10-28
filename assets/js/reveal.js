/*
 * Section reveal
 *
 * The section panels of index.md after the first one fade in the first time
 * they scroll into view, and then stay visible. Each <section class="panel">
 * gets .reveal (hidden) and then .is-revealed (styles in _sass/reveal.scss).
 *
 * Revealing a section also reveals the ones above it, so a jump (nav link,
 * scrollbar drag) never leaves blank sections behind. Sections already on
 * screen when the page loads are left alone. Without JS, or under reduced
 * motion, nothing is hidden.
 */

// Reveal a section once it is this far into the viewport.
const ROOT_MARGIN = "0px 0px -10% 0px";

function mount(content) {
    // The first section stays as it is.
    const sections = Array.from(content.querySelectorAll(":scope > section.panel")).slice(1);
    let revealed = 0;   // sections[0 .. revealed - 1] are visible

    const io = new IntersectionObserver((entries) => {
        let last = -1;
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                last = Math.max(last, sections.indexOf(entry.target));
            }
        });
        if (last >= 0) {
            revealUpTo(last);
        }
    }, { rootMargin: ROOT_MARGIN });

    function revealUpTo(index) {
        for (; revealed <= index; revealed++) {
            sections[revealed].classList.add("is-revealed");
            io.unobserve(sections[revealed]);
        }
        if (revealed === sections.length) {
            io.disconnect();
        }
    }

    // Sections that start below the viewport are hidden until reached.
    sections.forEach((section, i) => {
        if (section.getBoundingClientRect().top < window.innerHeight) {
            revealed = i + 1;
            return;
        }
        section.classList.add("reveal");
        io.observe(section);
    });
    if (revealed === sections.length) {
        io.disconnect();
    }
}

const content = document.querySelector(".content");
if (content && "IntersectionObserver" in window
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    mount(content);
}
