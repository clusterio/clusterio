# External plugins directory

This directory is `.gitignore`d. It is a convenient place to copy in plugins developed outside of the Clusterio repository so you can test them locally without dirtying your working tree.

**Important:** Plugins placed here are **no longer automatically incorporated** into the shared pnpm workspace. This was changed because `pnpm-lock.yaml` is now committed: auto-globbing `external_plugins/*` into the workspace would churn the committed lockfile every time a developer adds or changes a private plugin — causing merge conflicts between developers (and, if such a lockfile were pushed, `--frozen-lockfile` mismatches in CI, where `external_plugins/` is empty because it is gitignored).

To enable `--dev-plugin` for an external plugin, incorporate it into the workspace:

1. Add your plugin's path (e.g., `external_plugins/my-custom-plugin`) to the `packages` array in `pnpm-workspace.yaml`.
2. Run `pnpm install`.

That is enough for a plugin **cloned/copied directly into this directory** — pnpm links its dependencies to the workspace singletons, so the build shares one copy of `react`/`webpack`/`@clusterio/lib`. **No `injected: true` is needed**, and live-reload keeps working. (One caveat: delete any `node_modules` the plugin brought with it before `pnpm install`, otherwise Webpack resolves those duplicates first.)

**Symlinking** a plugin that lives outside the repository into here is **not supported** for `--dev-plugin`: the controller builds the plugin at its `external_plugins/` path, which resolves the symlink's real location and finds the plugin's own `node_modules` (duplicate `react`/`webpack`). `injected: true` does **not** fix this — it only rewrites `node_modules/<name>`, a path that build never uses. Copy the plugin's source in instead.

*(For the full explanation and snippets, see **Developing and Testing External Plugins** in `docs/writing-plugins.md`.)*
