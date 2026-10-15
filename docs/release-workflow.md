# Release workflow

## Update changelog

- CHANGELOG.md in the repository root
- The changelog.txt file in mod directories

Pull requests will usually have suggestions for changelog entries. These can be automatically parsed and formatted by running `node scripts/pr_to_changelog.mts`, though you will have to manually sort through which should go in the changelog in the repository root and which should go in the changelogs in mod directories.

If the script fails due to GitHub's 60/hour public access rate limit, you can set the `GH_TOKEN` environment variable to a fine-grained personal access token which has a much higher rate limits.

## Packages

The [Publish workflow](../.github/workflows/publish.yml) publishes npm packages and Lua mods when a GitHub release is published.
For this workflow, first merge the changelog and package version updates into `master`, then create and push the release tag on that merged commit.
Create a draft GitHub release for the existing tag and use the GitHub Release Markdown from `scripts/pr_to_changelog.mts` as its notes.
Publishing the draft triggers the workflow; pushing a tag alone does not.
The steps below describe publishing npm packages manually instead.

> [!NOTE]
> You will need commit access to the repository as well publish access to the @clusterio org on npm to do this.

1. Ensure you are on the latest version of master branch with no untracked files

    ```sh
    git switch master
    git pull --ff-only upstream master
    git status
    ```

2. Create a release branch and bump the version in the `package.json` files. The commands below use 2.0.1 to 2.0.2 as an example; substitute the versions for the release you are preparing.

    ```sh
    git switch -c release/2.0.2
    sed -i 's/"version": "2\.0\.1"/"version": "2.0.2"/' {packages,plugins}/*/package.json
    pnpm install --no-frozen-lockfile
    ```

3. Review and commit the version, lockfile and changelog changes, then open and merge a release pull request.

    ```sh
    git add -p
    git commit -m "Prepare 2.0.2 release"
    ```

4. After the release pull request is merged, tag the merged commit and push the tag.

    ```sh
    git switch master
    git pull --ff-only upstream master
    git tag v2.0.2
    git push upstream v2.0.2
    ```

5. For manual publication, perform a clean install and publish the packages. For automated publication, publish the GitHub release as described above instead.

    ```sh
    pnpm clean
    pnpm install --frozen-lockfile
    pnpm -r --filter='./packages/*' --filter='./plugins/*' --fail-if-no-match publish
    ```

## Plugins

1. Bump the version in the `package.json` file
2. Run `pnpm install` in the repository root
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
