# Clusterio installer

Installer for Clusterio.

Install the latest [Node.js LTS release](https://nodejs.org/en/download) before running the installer.
See [the Clusterio installation guide](https://github.com/clusterio/clusterio#installation) for platform-specific instructions.

Run the installer in a new empty directory:

    npm init "@clusterio"

It asks which components to install and how to set them up.
Every question can be answered with an option instead, pass options to the installer after `--`:

    npm init "@clusterio" -- --mode host --host-name my-host --controller-url https://example.com/

The installer runs without prompts when all the questions for the mode are answered with options.


## Modes

- `standalone`: controller and host on this computer.
  The host is added to the controller directly and does not need to be approved.
- `controller`: controller only.
- `host`: host only, joins the cluster of an existing controller, see [Setting up a host](#setting-up-a-host).
- `ctl`: the clusterioctl command line interface only.
- `plugins`: plugins only, for adding plugins to an existing installation.
- `plugin-template`: files for writing a new plugin.


## Options

| Option | Modes | Description |
| --- | --- | --- |
| `--mode <mode>` | all | Operating mode to install. |
| `--admin <name>` | standalone, controller | Name of the admin account to create. |
| `--http-port <port>` | standalone, controller | Port the controller web interface listens on, defaults to 8080. |
| `--host-name <name>` | host | Name to request for the host, defaults to the name of the computer. |
| `--controller-url <url>` | host, ctl | URL of the controller, the same as for its web interface. |
| `--controller-token <token>` | host, ctl | ctl: authentication token saved for clusterioctl. host: authentication token of a user that approves the host without waiting, it is not saved. |
| `--no-pair` | host | Install the host without pairing it with the controller. |
| `--public-address <address>` | standalone, host | DNS name or IP address players connect to this computer with. |
| `--factorio-dir <path>` | standalone, host | Path to the Factorio installation. |
| `--self-signed-cert <path>` | standalone, host | Certificate to trust for a controller using a self-signed certificate. It is used for pairing and added to the run scripts. |
| `--remote-npm`, `--no-remote-npm` | standalone, controller, host | Allow or deny remote updates, plugin updates and plugin installs from the web interface. |
| `--plugins <package...>` | all | Plugins to install, pass `--plugins` without packages to install none. |
| `--plugin-template <template...>`, `--plugin-name <name>` | plugin-template | Templates to use and name of the new plugin. |
| `--log-level <level>` | all | Log level to print, defaults to info. |
| `--allow-install-as-root` | all | Linux only, allow installing as root (not recommended). |
| `--migrate-rename` | | Migrate an installation from before the slave/master rename. |


## Setting up a host

A new host has to be approved before it can join the cluster:

1.  Run the installer with the host mode on the computer for the host.
    It asks for a name for the host, the controller URL, the public address, the Factorio installation, whether to allow remote updates and which plugins to install.

2.  Once it has installed everything it prints a code and waits for the host to be approved:

        Waiting for approval. Approve "my-host" with code ABC-DEF on the Hosts page of https://example.com/, or run: npx clusterioctl host approve ABC-DEF

3.  Approve the request by clicking Add host on the Hosts page of the web interface, or run `npx clusterioctl host approve ABC-DEF`.
    Only approve a request if its code matches the one shown by the installer.
    Approving requires the `core.host.approve` permission.

4.  The installer saves `host.id`, `host.name`, `host.controller_url` and `host.controller_token` to `config-host.json` and exits.
    Start the host with `run-host.cmd`, `run-host.sh` or the systemd service in the `systemd` folder.

Press Ctrl+C while the installer waits to cancel the request.
A request that is not approved within an hour expires.

Pass `--controller-token <token>` with the token of a user that has the `core.host.approve` permission to approve the host without waiting.
The token is only used for approving the host and is not saved.

If the controller uses a self-signed certificate pass it with `--self-signed-cert <path>`, see [setting up TLS](https://github.com/clusterio/clusterio/blob/master/docs/setting-up-tls.md#creating-and-using-a-self-signed-certificate).

When a host is revoked in the web interface or with `npx clusterioctl host revoke <host>` its token stops working and a running host shuts down.
Starting it again fails with exit code 8, which the run scripts do not restart on.


## Running the installer again

Running the installer with the host mode in a directory with `config-host.json` in it does not install anything, it only pairs the host again if needed:

- If the controller accepts the saved token it prints "Host is already set up" and exits with code 0.
- If it does not, for example because the host was revoked or never approved, it asks for the host name and controller URL, defaulting to the saved ones, and pairs the host again.
  The host gets a new id, other settings in `config-host.json` are kept.
- If the controller cannot be reached it prints a warning, keeps the saved config and exits with code 0.

The token is only checked with the controller in `config-host.json`.
Passing a different `--controller-url` pairs the host with that controller instead, without sending it the saved token, and the host gets a new id.
If the same controller only moved to a new address, change the address with `npx clusteriohost config set host.controller_url <url>` instead, which keeps the host.


## Docker

To run a host in a container install it when building the image with all answers given as options and `--no-pair`.
Then run the installer again with the host mode when the container starts, it pairs the host on the first start and exits straight away on later starts.

```dockerfile
FROM node:22
# Install the Factorio headless server to /opt/factorio here
RUN mkdir /clusterio && chown node:node /clusterio
USER node
WORKDIR /clusterio
RUN npm init "@clusterio" -- --mode host --no-pair --public-address factorio.example.com \
	--factorio-dir /opt/factorio --no-remote-npm --plugins
VOLUME /clusterio
CMD npm init "@clusterio" -- --mode host --controller-url "$CONTROLLER_URL" --host-name "$HOST_NAME" \
	${CONTROLLER_TOKEN:+--controller-token "$CONTROLLER_TOKEN"} && exec ./run-host.sh
```

    docker run -d --name my-host -v my-host:/clusterio -p 34100-34199:34100-34199/udp \
        -e CONTROLLER_URL=https://example.com/ -e HOST_NAME=my-host my-host-image
    docker logs my-host

- The volume holds `config-host.json`, without it every new container pairs as a new host.
  Docker copies the installation from the image into a new empty volume, later image updates do not change the installation in an existing volume.
- The code to approve is printed to the container log, or set `CONTROLLER_TOKEN` to approve the host without waiting.
- Stop the container after revoking its host, otherwise a restart runs the installer again and the host asks to join again.
