# KaTeX 0.19.1

Upstream: https://katex.org/ and https://github.com/KaTeX/KaTeX

Vendored from the official npm distribution:
https://registry.npmjs.org/katex/-/katex-0.19.1.tgz

Registry integrity (SHA-512), verified before extraction:
sha512-jG8uKntjSEcm2EpQOh0XturpPuuC9r3Sq5HLHdsFdWZT27E672SF19QEi+of0/YeOy15lDgRhKvr5614uRrEfA==

Included assets: dist/katex.mjs, dist/katex.min.css, dist/fonts/*.woff2 and LICENSE.
The ESM renderer has no browser network dependency. Modern browsers use the
bundled WOFF2 fonts. Upstream files are unmodified; application rendering limits
and trust settings are specified in public/markdown.js.

To update, fetch a pinned official npm release, verify its registry integrity,
replace these assets and license, and rerun the rendering/security/selection
tests plus live browser verification. Do not hand-edit the distribution files.
