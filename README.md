<img src="./logo.svg" width="100%" align="right">

<br/>
<br/>
<br/>

# Clusterio

Discord for development/support/play: https://discord.gg/5XuDkje

## Important notice

Clusterio 2.0 is the current stable release and requires Node.js 22 or newer.
For new installations, use the latest Node.js LTS release (see [Installation](#installation)).
The previous stable series is no longer supported.
If you are upgrading from a 2.0 alpha, review the [changelog](CHANGELOG.md) before upgrading.
Plugin authors should also follow the [2.0 migration guide](docs/devs/plugin-migration-to-2.0.md).


### Ways to support me/the project:

* Contribute with code/documentation.
  See [Contributing](docs/contributing.md) for how to make pull requests.
  Always nice to move the project forward.

* Support me monetarily on [patreon](https://www.patreon.com/danielv123) or paypal: danielv@live.no

### Table of contents

* [Introduction](#introduction)
* [Features](#features)
* [Plugins](#plugins)
* [Installation](#installation)
  * [Ubuntu setup](#ubuntu-setup)
  * [Windows setup](#windows-setup)
  * [MacOS setup](#macos-setup)
  * [Installing Plugins](#installing-plugins)
* [Configure Controller](#configure-controller)
* [Managing Factorio mods](#managing-factorio-mods)
* [Setting up shared storage](#setting-up-shared-storage)
* [Running Clusterio](#running-clusterio)
* [Setting up remote hosts](#setting-up-remote-hosts)
* [Setting up clusterioctl](#setting-up-clusterioctl)
* [Known issues](#known-issues)
* [Common problems](#common-problems)


## Introduction

Clusterio is a clustered Factorio server manager that provides the tooling for implementing cross server interactions in Factorio.
It was previously best known for implementing cross server transfer and cloud storage of items via teleporter chests.
But this functionality has been pulled out of Clusterio into its own plugin for Clusterio named [Subspace Storage](https://github.com/clusterio/subspace_storage).

By itself Clusterio doesn't change the gameplay in any way, you could even use Clusterio to manage completely vanilla Factorio servers.
Plugins do the work of modding in the visible changes into the game, see the [Plugins section](#plugins) for ready-made plugins you can install into a Clusterio cluster.


## Features

- Clustered Factorio server management allowing you manage the running of Factorio servers across a fleet of physical servers from both a web interface and a command line interface.

- User list management for synchronizing in-game admins, whitelisted users, and bans to all the servers in the cluster.

- Integrated support for exporting statistics for the whole cluster to Prometheus via a single metrics endpoint.

- Extensive plugin support for adding your own cross server features to Factorio using Clusterio's communication backbone.


## Plugins

The heart of Clusterio is its plugin system.
Plugins add functionality to Factorio servers, Clusterio itself or both.
These are the plugins supported and maintained by the Clusterio developers:

- [Global Chat](/plugins/global_chat/README.md): share the in-game chat between servers.
- [Research Sync](/plugins/research_sync/README.md): synchronize research progress and technologies unlocked and the research queue between servers.
- [Statistics Exporter](/plugins/statistics_exporter/README.md): collect in-game statistics from all the servers and makes it available to the Prometheus endpoint on the controller.
- [Subspace Storage](https://github.com/clusterio/subspace_storage): Provide shared storage that can transport items between servers via teleport chests.
- [Player Auth](/plugins/player_auth/README.md): Provides authentication to the cluster via logging into a Factorio server.
- [Player Sync](/plugins/player_sync/README.md): Synchronizes your inventory and player settings between servers.

There's also plugins developed and maintained by the community:

- [Discord Bridge](https://github.com/Hornwitser/discord_bridge) (@hornwitser/discord_bridge): Bridges chat between instances and Discord.
  By Hornwitser.
- [Server Select](https://github.com/Hornwitser/server_select/tree/clusterio-2.0) (@hornwitser/server_select): In-game GUI for connecting to other servers in the cluster.
  Originally by Godmave, ported to 2.0 by Hornwitser.
- [ExpCluster](https://github.com/explosivegaming/ExpCluster) (@expcluster/*): A collection of plugins and scenario features including role and group syncing, moderation tools, quality of life additions, and discord account linking.
  See repo readme for plugin breakdown. Maintained by Cooldude2606.
- [Chat Relay](https://github.com/PHIDIAS0303/chat_relay) (@PHIDIAS0303/chat_relay): Chat relay of Discord and Factorio, seperate channel.

The installer offers the six plugins maintained in this repository.
Community plugins are versioned and released independently of Clusterio; check their compatibility before installing them manually.

Want to make your own plugin?
Check out the documentation on [Writing Plugins](/docs/writing-plugins.md) for where to start.
If you have a plugin written for an earlier 2.0 alpha, see [Migrating Plugins to 2.0](/docs/devs/plugin-migration-to-2.0.md).
Note that from 2.0 onwards minor versions of Clusterio may contain breaking changes for plugins, while breaking changes for users running a cluster are held back for major versions.


## Installation

Install the latest [Node.js LTS release](https://nodejs.org/en/download), which is recommended for new Clusterio installations.
Clusterio is distributed via npm and comes with a guided install script.
If you already have a supported Node.js version installed, you can set it up in a new directory with:

    npm init "@clusterio"

Otherwise see below for OS specific instructions.  
Check out all our of decisions for [node, factorio, and operation support](/docs/decisions.md#supportability).

### Ubuntu setup

1.  Install the latest Node.js LTS release using the NodeSource repository for Ubuntu/Debian.
    The distribution's default repository may provide an older version.

        curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - &&\
        sudo apt-get install -y nodejs

    Verify the installation with `node --version` and `npm --version`.

2.  Log in as the user you wish to install Clusterio as (do not use root), and then create a new directory and run the Clusterio installer:

        mkdir clusterio
        cd clusterio
        npm init "@clusterio"

    Make sure to note down the admin authentication token it provides at the end as you will need it later.

3.  Optionally copy the generated systemd service files in `systemd` folder to `/etc/systemd/system/`.


**Ubuntu with Docker**

The Docker support for Clusterio is currently broken.
If you need it open an issue about it.

<!--
Clusterio has *very* limited support for using docker.

    sudo docker build -t clusterio --no-cache --force-rm clusterio

	sudo docker run --name controller -e MODE=controller -p 1234:8080 -d -it --restart=unless-stopped danielvestol/clusterio

	sudo docker run --name host -e MODE=host -e INSTANCE=world1 -v /srv/clusterio/instances:/clusterio/instances -p 1235:34167 -it --restart=unless-stopped danielvestol/clusterio

The -v flag is used to specify the instance directory.
Your instances (save files etc) will be stored there.
-->

### Windows setup

1.  Download and install the latest [Node.js LTS release](https://nodejs.org/en/download).

2.  Create a new empty directory for the installation and navigate into it.
    Open a PowerShell window in this new directory by Shift+Right clicking inside it and choosing "Open PowerShell window here" and then run the following command.

        npm init "@clusterio"

    Make sure to note down the admin authentication token it provides at the end as you will need it later.

3.  If you chose to use local factorio directory for the Factorio installation, download the Windows 64-bit zip package from https://www.factorio.com/download and extract it to the `factorio` folder in your clusterio installation folder.


### MacOS Setup

1.  Install the latest [Node.js LTS release](https://nodejs.org/en/download).
    If you use [nvm](https://github.com/nvm-sh/nvm#installing-and-updating), run `nvm install --lts`.

2.  Open Terminal or Command prompt in the directory you want to install to and run the following commands.

        mkdir clusterio
        cd clusterio
        npm init "@clusterio"

    Make sure to note down the admin authentication token it provides at the end as you will need it later.

3.  If you chose to use local factorio directory for the Factorio installation, you will need to obtain and copy a mac version of Factorio and unpack it to the `factorio` folder in your clusterio installation folder.


### Installing Plugins

For well-known plugins you can select them during installation and no further steps are necessary to make them work.
Plugins that are not offered by the installer can be installed by the name of the npm package that provides them, for example

    npx clusteriocontroller plugin install @clusterio/plugin-subspace_storage

This installs the package with npm and adds it to the default `plugin-list.json` file which in the shared folder setup is loaded by controller, host and ctl.
The command must be run from the directory clusterio was installed in and will refuse to run anywhere else.
If you have hosts or ctl installed on separate computers (or directories) then you need to repeat the plugin install process for all of them.
The clusteriocontroller, clusteriohost and clusterioctl commands has the plugin sub-command so you do not need to install clusteriocontroller to add plugins, instead use the clusterio command you have available.

For development purposes the `plugin add` command supports adding plugins by the absolute path to them, or a relative path that must start with either . or .. (which will then be resolved to an absolute path).


## Configure Controller

By default the controller will listen for HTTP on port 8080.
You can change the port used with the command

    npx clusteriocontroller config set controller.http_port 1234

When changing the port you will also need to change the address hosts connect with.
For the standalone installation mode you can use

    npx clusteriohost config set host.controller_url http://localhost:1234/

If you plan to make your cluster available externally set the address
that it will be accessible under with, for example

    npx clusteriocontroller config set controller.public_url http://203.0.113.4:1234/

Change the url to reflect the IP, protocol, and port the controller is accessible under, dns names are also supported.
If you're planning on making the controller accessible on the internet it's recommended to set up TLS, see the [Setting Up TLS](/docs/setting-up-tls.md) document for more details.

You can list the config of the controller with the `npx clusteriocontroller config list` command.
See the [readme for @clusterio/controller](/packages/controller/README.md) for more information.


## Managing Factorio mods

Mods in Clusterio are managed as parts of mod packs.
On the Mods page of the web interface, use **Search** to browse the Factorio Mod Portal and download mods to the controller, or upload mod zip files directly.
Mod Portal downloads require the controller's [Factorio account credentials](docs/configuration.md#controllerfactorio_username) to be configured.
Use **Create** in the Mod Packs section to create a mod pack, then add the mods you want to use.
Assign the mod pack to an instance under Instance config -> Factorio -> Mod pack, or set a default mod pack for new instances in the controller settings.

![Select mod pack for instance](docs/assets/config_select_mod_pack.png)

Mod settings can be managed under the modpack configuration page in the web UI. For mod settings to show, you first need to run an export. This is done by creating an instance with the modpack assigned, opening the instance page and pressing More -> Export data.

![Export mod configuration data](docs/assets/export_mod_config_data.png)

Once this is done, the mod settings will show up under the modpack configuration page.

![Mod settings configuration in web interface](docs/assets/mod_settings_configuration.png)


## Setting up shared storage

The chests teleporting items to and from the shared storage on the controller has been moved into the Subspace Storage mod and plugin.
To get this to work, install the Subspace Storage plugin on the controller and hosts using the [plugin installation instructions](#installing-plugins).
Download or upload the [Subspace Storage mod](https://mods.factorio.com/mod/subspace_storage) and the [Clusterio Lib mod](https://mods.factorio.com/mod/clusterio_lib) to the controller, add them to a mod pack, and assign it to each participating instance as described in [Managing Factorio mods](#managing-factorio-mods).
Hosts fetch the mods from the controller and synchronize each instance's mods folder with its assigned mod pack when the instance starts.

Do not install the [Clusterio mod](https://mods.factorio.com/mod/clusterio), this was for the old 1.2.x version of Clusterio and is not compatible with Clusterio 2.0.


## Running Clusterio

After completing the installation and creating your admin user, start up the controller and at least one host separately.
The installer provides the `run-controller` and `run-host` scripts to make this simple.
Once the controller process is running you can log into the web interface which is hosted by default on http://localhost:8080/ (adjust the port number if you changed it), use the admin authentication token provided from the installation to log in.

The basics of setting up a Factorio server from the web interface is to create an instance, assign it to a host and then click start. You can also use the "Connect via Steam" button to launch Factorio directly and connect to the server using Steam's protocol handler.

### Running via Systemd

The install script creates systemd service scripts for clusteriocontroller and clusteriohost (if applicable) to start up as the user than ran the installer.
If you have copied these files over to `/etc/systemd/system/` then you can startup Clusterio as a background service using:
    
#### To start as a service run:
 
    sudo systemctl start clusteriocontroller # for the controller
    sudo systemctl start clusteriohost # for each physical server intended to host Factorio servers

#### To automatically get it to start on boot:
 
    sudo systemctl enable clusteriocontroller # for the controller
    sudo systemctl enable clusteriohost # for each physical server intended to host Factorio servers


## Setting up remote hosts

Run the installer as described in the installation section and choose "Host only" as the operating mode to install, it'll ask for a controller URL and an authentication token.
The URL is the same as what is needed to connect to the web interface, and the authentication token can be generated on the Hosts page in the web interface.
Once you start up the host it should show up in the Hosts list and be available for assigning and running instances on.


## Setting up clusterioctl

There's a command line interface available for Clusterio which is installed separately with the same installer as for the controller and host.
Run the installer as described in the installation section and choose "Ctl only" as the operating mode to install, you can do this in the same directory as you have installed other Clusterio component(s) to.
The installer will ask for a controller URL and an authentication token, these are the same as you would use to connect to the web interface.
If you want to use a different user for the command line interface, you can generate an authentication token for an existing user with

    npx clusteriocontroller bootstrap generate-user-token <username>


## Known Issues

- `@hornwitser/server_select@2.0.1` fails to load with Clusterio 2.0 because its entrypoints omit the required `.js` extension.
  `@hornwitser/discord_bridge@0.2.5` is not automatically discovered because it lacks the `clusterio-plugin` keyword.
  The Clusterio 2.0.2 installer still offers these versions; leave them unchecked until compatible plugin releases are available.
  If already installed, stop the controller and host, run `npm uninstall @hornwitser/server_select @hornwitser/discord_bridge` in each affected installation directory, and restart them to continue with the core plugins.
  See [#1102](https://github.com/clusterio/clusterio/issues/1102).
- After updating Factorio you may get the error `Error: Expected empty response but got "Cannot execute command. Error: [string "clusterio_private.update_instance(..."]:1: attempt to index global 'clusterio_private' (a nil value)?` on instance start.
  This is due to Factorio applying a migration replacing the patched content of the save with the original scenario, attempting to start the instance again should resolve the issue.


## Common problems

### EACCESS [...] LISTEN 443

Some systems don't let non root processes listen to ports below 1000.
Either run with `sudo` or change config.json to use higher port numbers.

According to [this link](https://askubuntu.com/questions/839520/open-port-443-for-a-node-web-app) if you manually installed node.js following the above instructions, you may need to run the following command to fix this issue:

    sudo setcap 'cap_net_bind_service=+ep' $(readlink -f $(which node))

### Port forwarding doesn't work on the controller when running under WSL

If you follow the ubuntu guide on WSL (Windows Subsystem for Linux, Bash on Ubuntu on Windows specifically), you will find that the website works on localhost and on your local ip, but not on the global ip.
This is also true when you correctly port-forwarded the correct ports.
Even when routing this server through nginx in WSL, the issue persists.
Then, on a hunch, I tried to run nginx from windows itself and found that this DID work.
It came to me that the only usage difference between the 2 versions of nginx is that I got a Windows Firewall popup.

TLDR: the tested fix is:

- open your windows firewall and go to advanced settings

- click on inbound rules and click on new rule...

- select port and click next >

- select TCP and select specific local ports and type in the ports that you want to open (comma separated) and click next > 3 times

- give the rule a name (like 'web server' or something), give it a description (optionally) and click finish
