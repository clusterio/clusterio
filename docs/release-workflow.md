# Release workflow

## Update changelog

- CHANGELOG.md in the repository root
- The changelog.txt file in mod directories

Pull requests will usually have suggestions for changelog entries.

## Packages

> [!NOTE]
> You will need commit access to the repository as well publish access to the @clusterio org on npm to do this.

1. Ensure you are on the latest version of master branch with no untracked files

    ```sh
    git switch master
    git pull --ff-only upstream master
    git status
    ```

2. Bump the version in the `package.json` files

    ```sh
    sed -i 's/2\.0\.0-alpha\.XX/2\.0\.0-alpha\.YY/' {packages,plugins}/*/package.json
    ````

3. Tag and push the release to github

    ```sh
    git add -p
    git commit -m v2.0.0-alpha.XX
    git tag v2.0.0-alpha.XX
    ```

4. Perform a clean install and publish the packages.

    ```sh
    pnpm clean
    pnpm -r --filter='./{plugins,packages}/*' publish
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
