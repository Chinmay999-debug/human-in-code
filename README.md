# For Aayushi — A Portrait in Code

A portrait made for Aayushi, rebuilt from thousands of text characters on HTML Canvas. Characters
drift as a field, then fly in and assemble into the face.

React + Vite + TypeScript, Canvas 2D. No backend, no tracking, fonts self-hosted.

```sh
npm install
npm run dev        # http://localhost:5173/
npm run build      # static site in dist/ (relative base, works on GitHub Pages subpaths)
npm run preview
```

`scripts/preprocess.py` (Pillow) crops the source photo to the face, boosts
local contrast, fades the background and writes `public/portrait-map.png`,
which is what the site samples at runtime. Re-run with `npm run preprocess`
after changing the source image.

Keys: `R` replay · `S` scatter. Hover the portrait to disturb it.

Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.
The original source photo is git-ignored; only the processed `portrait-map.png` is published.
