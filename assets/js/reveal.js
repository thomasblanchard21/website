/*
 * Section reveal
 *
 * The sections of index.md after the first one fade in the first time they
 * scroll into view, and then stay visible. A section is an <h2> of .content
 * and the elements that follow it up to the next <h2>; they aren't wrapped,
 * so each element gets .reveal (hidden) and then .is-revealed (styles in
 * _sass/reveal.scss).
 *
 * Revealing a section also reveals the ones above it, so a jump (nav link,
 * scrollbar drag) never leaves blank sections behind. Sections already on
 * screen when the page loads are left alone. Without JS, or under reduced
 * motion, nothing is hidden.
 */

// Reveal a section once it is this far into the viewport.
const ROOT_MARGIN = "0px 0px -10% 0px";

function sectionsOf(content) {
    const sections = [];
    for (const el of content.children) {
        if (el.tagName === "H2") {
            sections.push([]);
        }
        if (sections.length) {
            sections[sections.length - 1].push(el);
        }
    }
    return sections;
}

function mount(content) {
    // The first section stays as it is.
    const sections = sectionsOf(content).slice(1);
    const sectionOf = new Map();
    let revealed = 0;   // sections[0 .. revealed - 1] are visible

    const io = new IntersectionObserver((entries) => {
        let last = -1;
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                last = Math.max(last, sectionOf.get(entry.target));
            }
        });
        if (last >= 0) {
            revealUpTo(last);
        }
    }, { rootMargin: ROOT_MARGIN });

    function revealUpTo(index) {
        for (; revealed <= index; revealed++) {
            sections[revealed].forEach((el) => {
                el.classList.add("is-revealed");
                io.unobserve(el);
            });
        }
        if (revealed === sections.length) {
            io.disconnect();
        }
    }

    // Sections that start below the viewport are hidden until reached.
    sections.forEach((section, i) => {
        if (section[0].getBoundingClientRect().top < window.innerHeight) {
            revealed = i + 1;
            return;
        }
        section.forEach((el) => {
            el.classList.add("reveal");
            sectionOf.set(el, i);
            io.observe(el);
        });
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
