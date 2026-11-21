# Release workflow

## Update changelog

- CHANGELOG.md in the repository root
- The changelog.txt file in mod directories

Pull requests have a changelog section that is parsed and formatted by `node scripts/pr_to_changelog.mts`.
The prepare release script below adds its output to CHANGELOG.md, but changes to mods still have to be copied into the changelogs in the mod directories by hand.

If the script fails due to GitHub's 60/hour public access rate limit, you can set the `GH_TOKEN` environment variable to a fine-grained personal access token which has a much higher rate limits.

## Packages

The [Publish workflow](../.github/workflows/publish.yml) publishes npm packages and Lua mods on GitHub's `release: released` event for a stable release.
Publishing a prerelease does not trigger it; see [GitHub's release event documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release).
The npm release includes the packages under `packages/` and the six core plugins under `plugins/`.
Community plugins hosted in separate repositories have independent versions and releases.
For this workflow, push the commit and tag made by `scripts/prepare_release.mts` to `master`.
Create a draft GitHub release for the existing tag and use the GitHub Release Markdown printed by `scripts/prepare_release.mts` as its notes.
Publishing the draft as a stable release triggers the workflow; pushing a tag alone does not.
Preparing a release, pushing a tag, and publishing a release or packages are separate actions; obtain authorization for the publication steps before executing them on someone else's behalf.
The steps below describe publishing npm packages manually instead.

> [!NOTE]
> You will need commit access to the repository as well publish access to the @clusterio org on npm to do this.

1. Inspect `git status` and `git remote -v`, verify which remote is the main repository, and use a clean release worktree on its latest master.
   The commands below assume that remote is named `upstream`; preserve unrelated work and external plugin checkouts.

    ```sh
    git switch master
    git pull --ff-only upstream master
    git status
    ```

2. Run the prepare release script with the new version.
   It sets the version in the `package.json` files under `packages/` and `plugins/`, adds the changelog from merged pull requests to the top of CHANGELOG.md, commits it as "Prepare 2.0.2" and tags that commit `v2.0.2`.
   Nothing is pushed.
   It also prints the GitHub Release Markdown for the release notes.

    ```sh
    node scripts/prepare_release.mts 2.0.2
    ```

3. Review the commit, amend it if the changelog needs edits, then push it and the tag.
   If you amend the commit, move the tag with `git tag -f v2.0.2`.

    ```sh
    git show HEAD
    git push upstream master v2.0.2
    ```

4. For manual publication, perform a clean install and publish the packages. For automated publication, publish the GitHub release as described above instead.

    The repository does not track `pnpm-lock.yaml`, so allow pnpm to generate or update it during installation.

    ```sh
    node scripts/clean.js --dry-run
    pnpm clean
    pnpm install --no-frozen-lockfile
    pnpm -r --filter='./packages/*' --filter='./plugins/*' --fail-if-no-match publish
    ```

## Plugins

1. Bump the version in the `package.json` file
2. Run `pnpm install --no-frozen-lockfile` in the repository root
3. Run `pnpm adduser` to authenticate
4. Run `pnpm publish` in the plugin/package directory

Before confirming the publish, ensure the packed size is approximately the same size as the last version (or within the expected size)

After publishing, test creating and installing the plugin on a fresh install.

## Lua mods

To publish lua mods like clusterio_lib, start by building from source:

```sh
pnpm run build-mod
```

or download the latest artifacts from the CI. When uploading the mods to the mod portal, make sure the latest version is the last version uploaded, as the game/mod portal/ingame updater isn't consistent in how it figures out the "latest version"

## Release notes

Release notes are expected to be published alongside new releases. We use the github releases system as well as posting in the #announcements channel on the discord. Major releases may warrant a ping.
