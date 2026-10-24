# AGENTS.md

Instructions for AI coding agents working on this repository.

## Project overview

This is Thomas Blanchard's personal website. It introduces him: who he is, his interests, his projects, and so on.
It is a static site built with [Jekyll](https://jekyllrb.com/), forked from the
[`ankitsultana/researcher`](https://github.com/ankitsultana/researcher) template: a clean, single-column, monospace resume theme.

The template is being personalized **incrementally**. Prefer small, focused changes over large rewrites.
Later the plan is to add visual effects built with **three.js and/or WebGL shaders** (see [Visual effects](#visual-effects-threejs--webgl)).

## Setup and commands

Ruby gems install locally into `vendor/bundle` (set in `.bundle/config`, git-ignored).

```bash
bundle install                 # install dependencies
bundle exec jekyll serve       # dev server with live regeneration at http://localhost:4000{baseurl}/
bundle exec jekyll build       # one-off build into _site/ (use this to check a change compiles)
```

- The "GitHub Metadata: No GitHub API authentication could be found" warning is expected locally. Ignore it.
- Changes to `_config.yml` are **not** picked up by `jekyll serve`'s auto-regeneration. Restart the server.
- Never edit `_site/`, `.jekyll-cache/`, or `vendor/`. They are generated and git-ignored.
- There is no test suite. After a change, verify that `bundle exec jekyll build` succeeds with no new warnings,
  and check the affected pages in the served site, at both desktop and narrow (< 500px) widths.

## Repository layout

| Path | Purpose |
|------|---------|
| `_config.yml` | Site settings: `title`, `author`, `description`, `url`, `baseurl`, `nav` items, footer, `ins_logo` |
| `_layouts/default.html` | The only layout: `<head>`, navbar, content wrapper, footer |
| `_sass/vars.scss` | Customization variables (`$accent`, `$image-size`) and breakpoints |
| `_sass/_style.scss`, `typography.scss`, `tables.scss` | Theme styles |
| `css/main.scss` | Sass entry point (has empty front matter so Jekyll processes it) |
| `index.md` | Home/About page |
| `contact.md` | Contact page (`is_contact: true` in front matter adds the `contact` CSS class) |
| `resume.pdf`, `sherlock.jpg`, `bits-logo.png` | Template placeholder assets, to be replaced |

New pages: add `foo.md` at the root with `layout: default` front matter. It is served at `/foo`.
Add it to `nav` in `_config.yml` if it should appear in the navbar.

## Deployment and constraints

- The site is deployed with **GitHub Pages**, built by GitHub from the `gh-pages` branch, which is the default/main branch.
- It is configured as a **user site**: `url: "https://thomasblanchard21.github.io"`, `baseurl: ""`.
  This requires the GitHub repo to be named `thomasblanchard21.github.io`. Do not rename the repo or change GitHub
  settings yourself. If the site turns out to be served under `/website`, tell Thomas.
- The `Gemfile` uses the `github-pages` gem, which pins Jekyll and allows **only
  [whitelisted plugins](https://pages.github.com/versions/)**. Do not add Jekyll plugins or gems that GitHub Pages
  does not support. If a feature needs one, propose an alternative or ask first.
- **Never hardcode the base path.** Build internal links and asset URLs with Liquid's `relative_url` filter
  (for example `{{ "/css/main.css" | relative_url }}`) so that the site works whatever `baseurl` is.
  `nav` links in `_config.yml` are root-relative (`/contact`) and the layout runs them through `relative_url`.
  Links containing `://` are left as they are.
- If a needed feature isn't possible under these limits (a non-whitelisted plugin, Jekyll 4, modern Sass `@use`,
  an npm build step), the escape hatch is to build with a **GitHub Actions** workflow instead of GitHub's built-in
  build. Propose it to Thomas rather than setting it up unasked.
- No Node/npm build step. The repo stays a pure Jekyll project.

## Content guidelines

- Most of the current content is template placeholder (Sherlock Holmes bio, lorem ipsum, fake contact details).
  Replace it progressively.
- If a change needs personal content Thomas hasn't provided (bio, projects, publications, contact info),
  **write a clearly marked placeholder** instead of inventing facts, for example `<!-- TODO(thomas): describe project X -->`
  or a visible `TODO:` line. List the placeholders you added in your summary.
- Never put fabricated publications, affiliations, dates, or contact details on the site as if they were real.
- No analytics or tracking scripts. Thomas chose to have none.
- **License:** the upstream template is GPL-3.0 (`LICENSE`). Keep the `LICENSE` file, and keep credit to the original
  template (the footer currently links to Ankit Sultana).

## Code style

- Match the existing code: 4-space indentation in HTML/Liquid and SCSS, and a plain, minimal style.
- Put new styles in the existing `_sass/` partials or in a new partial imported from `_style.scss`. No inline styles.
- Colors and sizes that may be tweaked belong in `_sass/vars.scss`.
- Preserve the responsive behavior (breakpoints `$max-width`, `$med-width`, `$small-width`) and keep pages readable at phone width.
- Keep the semantics accessible: alt text on images, real links and headings, sufficient color contrast.

## Visual effects (three.js / WebGL)

This is a planned direction. Follow these rules when you implement it:

- **Loading:** use native ES modules with an `<script type="importmap">` pointing to a **pinned version** of three.js
  on a CDN (for example `https://cdn.jsdelivr.net/npm/three@<exact-version>/build/three.module.js`, plus `addons/` for extras).
  Never use unpinned/`latest` URLs. Do not vendor three.js and do not add a bundler.
- **Where code lives:** site JavaScript goes in `assets/js/`, and GLSL shaders go in `assets/shaders/` (or as template
  strings in the JS module if they are small). Load scripts from the layout or from an include in `_includes/`
  only on the pages that use them, for example behind a front matter flag like `effects: true`.
- **Progressive enhancement:** the site must stay fully usable and readable without JavaScript or WebGL.
  Effects are decoration. Detect WebGL support and fail silently to the plain theme.
- **Accessibility:** respect `prefers-reduced-motion` (disable or freeze the animation) and never let effects get in the way of text
  legibility or contrast. Canvas elements used purely for decoration get `aria-hidden="true"`.
- **Performance:** cap the device pixel ratio (around `Math.min(devicePixelRatio, 2)`), pause rendering when the tab is
  hidden or the canvas is off-screen, handle resize, and dispose of GPU resources when tearing down. Test on a mobile-sized viewport.
- Keep each effect self-contained (one module per effect) so it can be toggled or removed easily.

## Git workflow

- `gh-pages` is the published branch. **Anything pushed to it goes live.** Never commit or push to `gh-pages` directly.
- Work on a feature branch (for example `feat/threejs-hero` or `content/about-page`), commit with clear messages, and
  open a pull request against `gh-pages` with the `gh` CLI. Thomas reviews and merges.
- Keep each PR focused on one change, and describe in the PR how you verified it (build output, pages checked).
- Never force-push, rewrite published history, or change repository settings.

## Known issues

- `index.md`, `contact.md`, `resume.pdf`, and `sherlock.jpg` still hold template placeholder content.
- `description` in `_config.yml` is empty (marked `TODO(thomas)`).
