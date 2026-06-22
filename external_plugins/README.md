# External plugins directory

This directory is `.gitignore`d. It is a convenient place to symlink plugins developed outside of the Clusterio repository so you can test them locally without dirtying your working tree.

**Important:** Plugins placed here are **no longer automatically incorporated** into the shared pnpm workspace. This was changed to prevent `pnpm-lock.yaml` merge conflicts between developers working on different custom plugins.

To enable `--dev-plugin` and incorporate your external plugin into the workspace dependencies:
1. Manually add your plugin's path (e.g., `external_plugins/my-custom-plugin`) to the `packages` array in `pnpm-workspace.yaml`.
2. Add it as a workspace dependency with `injected: true` in `package.json`.
3. Run `pnpm install`.

*(For the full snippet and explanation of why `injected: true` is required to fix Webpack duplicate singleton bugs, see **Developing and Testing External Plugins** in `docs/writing-plugins.md`)*
