/*
 * One-page navigation
 *
 * Shows the slim .sticky-bar once the header banner has scrolled out of
 * view, and marks the bar link and the dot of the section on screen
 * (.is-current, aria-current). A section is the panel holding an <h2 id>;
 * the first one counts as the top of the page ("#top").
 * Smooth scrolling and snapping between sections are plain CSS, see
 * _sass/sticky-bar.scss and _sass/panels.scss. Without JS the bar stays hidden.
 */

function mount(bar, banner) {
    // Section headings, in page order (ids set in index.md; the first one's
    // id doesn't matter, it stands for "#top").
    const sections = Array.from(document.querySelectorAll(".content h2[id]"));
    const links = Array.from(document.querySelectorAll(
        ".sticky-bar-links a[href*='#'], .section-dots a[href*='#']",
    )).filter((a) => {
        const url = new URL(a.href);
        return url.pathname === location.pathname;
    });
    let frame = 0;
    let current = null;

    function currentId() {
        const doc = document.documentElement;
        if (sections.length && window.scrollY > 0 && window.innerHeight + window.scrollY >= doc.scrollHeight - 2) {
            // At the very bottom, the last section may be too short to reach the top.
            return sections[sections.length - 1].id;
        }
        // The section filling the middle of the window.
        const line = window.innerHeight / 2;
        let id = "top";
        sections.forEach((section, i) => {
            const panel = section.closest(".panel") || section;
            if (i > 0 && panel.getBoundingClientRect().top <= line) {
                id = section.id;
            }
        });
        return id;
    }

    function update() {
        frame = 0;
        bar.classList.toggle("is-visible", banner.getBoundingClientRect().bottom <= bar.offsetHeight);
        const id = currentId();
        if (id === current) {
            return;
        }
        current = id;
        links.forEach((a) => {
            const on = new URL(a.href).hash === "#" + id;
            a.classList.toggle("is-current", on);
            if (on) {
                a.setAttribute("aria-current", "location");
            } else {
                a.removeAttribute("aria-current");
            }
        });
    }

    function schedule() {
        if (!frame) {
            frame = requestAnimationFrame(update);
        }
    }

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    update();
}

const bar = document.querySelector(".sticky-bar");
const banner = document.querySelector(".banner");
if (bar && banner) {
    mount(bar, banner);
}
