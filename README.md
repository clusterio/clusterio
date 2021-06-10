<img src="./logo.svg" width="100%" align="right">

<br/>
<br/>
<br/>

# Clusterio

Discord for development/support/play: https://discord.gg/5XuDkje

## Important notice

Clusterio 2.0 is still in alpha, however the previous stable has been abandoned and is no longer supported.
Despite being alpha it's reasonably stable now and there's no major breakages expected before a stable release of 2.0.
If you are starting a new cluster it's highly recommended to use the 2.0 alpha.


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
* [Configure Master Server](#configure-master-server)
* [Running Clusterio](#running-clusterio)
* [Setting up remote slaves](#setting-up-remote-slaves)
* [Setting up clusterioctl](#setting-up-clusterioctl)
* [Common problems](#Common-problems)


## Introduction

Clusterio is a clustered Factorio server manager that provides the tooling for implementing cross server interactions in Factorio.
It was previously best known for implementing cross server transfer and cloud storage of items via teleporter chests.
But this functionality has been pulled out of Clusterio into its own plugin for Clusterio named [Subspace Storage](https://github.com/clusterio/subspace_storage).

By itself Clusterio doesn't change the gameplay in any way, you could even use Clusterio to manage completely vanilla Factorio servers.
Plugins do the work of modding in the visible changes into the game, see the [Plugins section](#plugins) for ready made plugins you can install into a Clusterio cluster.


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
- [Research Sync](/plugins/research_sync/README.md): synchronize research progress and technologies unlocked between servers.
- [Statistics Exporter](/plugins/statistics_exporter/README.md): collect in-game statistics from all the servers and makes it available to the Prometheus endpoint on the master server.
- [Subspace Storage](https://github.com/clusterio/subspace_storage): Provide shared storage that can transport items between servers via teleport chests.
- [Player Auth](/plugins/player_auth/README.md): Provides authentication to the cluster via logging into a Factorio server.
- [Inventory Sync](/plugins/inventory_sync/README.md): Synchronizes your inventory between servers.

There's also plugins developed and maintained by the community:

- [Discord Bridge](https://github.com/Hornwitser/discord_bridge) (@hornwitser/discord_bridge): Bridges chat between instances and Discord.
  By Hornwitser.
- [Server Select](https://github.com/Hornwitser/server_select/tree/clusterio-2.0) (@hornwitser/server_select): In-game GUI for connecting to other server in the cluster.
  Originally by Godmave, ported to 2.0 by Hornwitser.

Want to make your own plugin?
Check out the documentation on [Writing Plugins](/docs/writing-plugins.md) for where to start.


## Installation

Clusterio runs on Node.js v12 and up, it's distributed via npm and comes with a guided install script.
If you alread have a recent Node.js installed you can set it up in a new directory with.

    npm init "@clusterio"

Otherwise see below for OS specific instructions.


### Ubuntu setup

1.  Install Node.js v12 or higher.
    For 20.04 LTS or below the version of Node.js provided by the Ubuntu repos are too old and you will have to use the nodesource PPA, otherwise you may skip the first line.

        wget -qO - https://deb.nodesource.com/setup_14.x | sudo -E bash -
        sudo apt install nodejs

2.  Create a new directory and run the Clusterio installer:

        mkdir clusterio
        cd clusterio
        npm init "@clusterio"

    Make sure to note down the admin authentication token it provides at the end as you will need it later.

3.  If you chose to use local factorio directory for the Factorio installation then download the headless build of Factorio and unpack it:

        wget -O factorio.tar.gz https://www.factorio.com/get-download/latest/headless/linux64
        tar -xf factorio.tar.gz

    To specify a version of Factorio to download replace "latest" in the URL with a version number like "1.0.0".

4.  Optionally copy the generated systemd service files in `systemd` folder to `/etc/systemd/system/`.


**Ubuntu with Docker**

The Docker support for Clusterio is curently broken.
If you need it open an issue about it.

<!--
Clusterio has *very* limited support for using docker.

    sudo docker build -t clusterio --no-cache --force-rm clusterio

	sudo docker run --name master -e MODE=master -p 1234:8080 -d -it --restart=unless-stopped danielvestol/clusterio

	sudo docker run --name slave -e MODE=slave -e INSTANCE=world1 -v /srv/clusterio/instances:/clusterio/instances -p 1235:34167 -it --restart=unless-stopped danielvestol/clusterio

The -v flag is used to specify the instance directory.
Your instances (save files etc) will be stored there.
-->

### Windows setup

1.  Download and install the latest LTS release from http://nodejs.org.

2.  Create a new empty directory for the installation and navigate into it.
    Open a PowerShell window in this new directory by Shift+Right clicking inside it and choosing "Open PowerShell window here" and then run the following command.

        npm init "@clusterio"

    Make sure to note down the admin authentication token it provides at the end as you will need it later.

3.  If you chose to use local factorio directory for the Factorio installation then download the Windows 64-bit zip package from https://www.factorio.com/download and extract it to the `factorio` folder in your clusterio installation folder.


### MacOS Setup

1.  Install the latest Node.js LTS release from http://nodejs.org or use brew (`brew install node`).

2.  Open Terminal or Command prompt in the directory you want to install to and run the following commands.

        mkdir clusterio
        cd clusterio
        npm init "@clusterio"

    Make sure to note down the admin authentication token it provides at the end as you will need it later.

3.  If you chose to use local factorio directory for the Factorio installation you will need to obtain and copy a mac version of Factorio and unpack it to to the `factorio` folder in your clusterio installation folder.


### Installing Plugins

For well known plugins you can select them during installation and no further steps are necessary to make them work.
Installing plugins that are not offered by the installer consists of two steps.
First install the package the plugin is provided by via npm, for example

    npm install @clusterio/plugin-subspace_storage

Then tell clusterio that this plugin exists by adding it as a plugin.

    npx clusteriomaster plugin add @clusterio/plugin-subspace_storage

This adds it to the default `plugin-list.json` file which in the shared folder setup is loaded by master, slave and ctl.
If you have slaves or ctl installed on separate computers (or directories) then you need to repeat the plugin install process for all of them.
The clusteriomaster, clusterioslave and clusterioctl commands has the plugin sub-command so you do not need to install clusteriomaster to add plugins, instead use the clusterio command you have available.

For development purposes the `plugin add` command supports adding plugins by the absolute path to them, or a relative path that must start with either . or .. (which will then be resolved to an absolute path).


## Configure Master Server

By default the master server will listen for HTTP on port 8080.
You can change the port used with the command

    npx clusteriomaster config set master.http_port 1234

When changing the port you will also need to change the address slaves connect with.
For the standalone installation mode you can use

    npx clusterioslave config set slave.master_url http://localhost:1234/

If you plan to make your cluster available externally set the address
that it will be accessible under with, for example

    npx clusteriomaster config set master.external_address http://203.0.113.4:1234/

Change the url to reflect the IP, protocol, and port the master server is accessible under, dns names are also supported.
If you're planning on making the master server accessible on the internet it's recommended to set up TLS, see the [Setting Up TLS](/docs/setting-up-tls.md) document for more details.

You can list the config of the master server with the `npx clusteriomaster config list` command.
See the [readme for @clusterio/master](/packages/master/README.md) for more information.


## Running Clusterio

After completing the installation start up the master server and at least one slave separately.
The installer provides the `run-master` and `run-slave` scripts to make this simple.
Once the master process is running you can log into the web interface which is hosted by default on http://localhost:8080/ (adjust the port number if you changed it), use the admin authentication token provided from the installation to log in.

The basics of setting up a Factorio server from the web interface is to create an instance, assign it to a slave and then click start.


## Setting up remote slaves

Run the installer as described in the installation section and choose "Slave only" as the operating mode to install, it'll ask for a master URL and an authentication token.
The URL is the same as what is needed to connect to the web interface, and the athentication token can be generated on the Slaves page in the web interface.
Once you start up the slave it should show up in the Slaves list and be available for assigning and running instances on.


## Setting up clusterioctl

There's a command line interface available for Clusterio which is installed separately with the same installer as for the master and slave.
Run the installer as described in the installation section and choose "Ctl only" as the operating mode to install, you can do this in the same directory as you have installed other clusterio component(s) to.
The installer will ask for a master URL and an authentication token, these are the same as you would use to connect to the web interface.
If you want to use a different user for the command line interface you can generate an authentication token for an existing user with

    npx clusteriomaster bootstrap generate-user-token <username>


## Common problems

### EACCESS [...] LISTEN 443

Some systems don't let non root processes listen to ports below 1000.
Either run with `sudo` or change config.json to use higher port numbers.

According to [this link](https://askubuntu.com/questions/839520/open-port-443-for-a-node-web-app) if you manually installed node.js following the above instructions, you may need to run the following command to fix this issue:

    sudo setcap 'cap_net_bind_service=+ep' $(readlink -f $(which node))

### Portforwarding doesn't work on the master server when running under WSL

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
