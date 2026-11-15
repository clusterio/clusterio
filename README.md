# Plugin page layout screenshots

These screenshots render the real `PluginsPage`, `PluginVersions`, and `SiteLayout` components with synthetic controller/host responses.
They are layout evidence, not a live cluster installation or restart test.
The fixture has two machines, a pending awf_oarc update and web load error, an Auto Restart plugin without a host entrypoint, a Global Chat update, and an up-to-date Research Sync plugin.

Before: `61f2b0117263516b592bba0b397e887065de5c4d`.
After: `8229db75`.
Mobile viewport: 390 x 844 CSS pixels.
Desktop viewport: 1440 x 900 CSS pixels.
Both use Edge through Playwright, device scale factor 1, dark theme, the same data and default sorting.

The screenshots are kept on a separate evidence branch so they are not part of the code PR's diff.

To reproduce, put `main.tsx`, `index.html`, `serve.mjs`, `capture.mjs` and `check.mjs` in `temp/plugin-layout/` of a Clusterio checkout.
Run `pnpm install --no-frozen-lockfile`, `npm install --prefix temp/plugin-layout --no-package-lock --no-save playwright`, and `node temp/plugin-layout/serve.mjs` from the repository root.
With Microsoft Edge installed, run `node temp/plugin-layout/capture.mjs before` at the baseline or `node temp/plugin-layout/capture.mjs after` at the fixed commit.
Run `node temp/plugin-layout/check.mjs` at the fixed commit for viewport bounds, search, sorting, navigation, account menu and checklist checks.
