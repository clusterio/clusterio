<img src="./logo.svg" width="100%" align="right">

<br/>
<br/>
<br/>

# factorioClusterio

Discord for development/support/play: https://discord.gg/5XuDkje

## Important notice

This is the development branch for factorioClusterio 2.0 which is currently undergoing heavy
restructuring and refactoring.  Expect plugins and existing installations to frequently break when
using this branch.  If you don't want to be an alpha tester for 2.0 please use the stable
[1.2.x branch][1.2.x] or
[latest stable release](https://github.com/clusterio/factorioClusterio/releases/latest).

Installation instructions below are for the unstable master branch.  Go to the page for
the [1.2.x branch][1.2.x] for instructions on how to install the stable version.

[1.2.x]: https://github.com/clusterio/factorioClusterio/tree/1.2.x

### Ways to support me/the project:

* Contribute with code/documentation. See [Contributing](docs/contributing.md) for how to make pull
  requests.  Always nice to move the project forward.

* Support me monetarily on [patreon](https://www.patreon.com/danielv123) or paypal: danielv@live.no

### Table of contents

* [Introduction](#introduction)
* [Features](#features)
* [Plugins](#plugins)
* [Ubuntu setup](#ubuntu-setup)
* [Windows setup](#windows-setup)
* [Installing Plugins](#installing-plugins)
* [Configure Master Server](#configure-master-server)
  * [Hosting Behind Proxy](#hosting-behind-proxy)
  * [Setting up an admin account](#setting-up-an-admin-account)
* [Running Clusterio](#running-clusterio)
  * [Master Server](#master-server)
  * [Slaves](#slaves)
  * [Instances](#instances)
* [Common problems](#Common-problems)


## Introduction

Clusterio is a clustered Factorio server manager that provides the
tooling for implementing cross server interactions in Factorio.  It
was previously best known for implementing cross server transfer and
cloud storage of items via teleporter chests.  But this functionality
has been pulled out of Clusterio into its own plugin for Clusterio named
[Subspace Storage](https://github.com/clusterio/factorioClusterioMod).

By itself Clusterio doesn't change the gameplay in any way, you could
even use Clusterio to manage completely vanilla Factorio servers.
Plugins do the work of modding in the visible changes into the game, see
the [Plugins section](#plugins) for ready made plugins you can install
into a Clusterio cluster.


## Features

- Clustered Factorio server management allowing you manage the running
  of Factorio servers across a fleet of physical servers from both a web
  interface and a command line interface.

- User list management for synchronizing in-game admins, whitelisted
  users, and bans to all the servers in the cluster.

- Integrated support for exporting statistics for the whole cluster to
  Prometheus via a single metrics endpoint.

- Extensive plugin support for adding your own cross server features to
  Factorio using Clusterio's communication backbone.


## Plugins

The heart of Clusterio is its plugin system.  Plugins add functionality
to Factorio servers, Clusterio itself or both.  These are the plugins
supported and maintained by the Clusterio developers:

- [Global Chat](/plugins/global_chat/README.md): share the in-game chat
  between servers.
- [Research Sync](/plugins/research_sync/README.md): synchronize
  research progress and technologies unlocked between servers.
- [Statistics Exporter](/plugins/statistics_exporter/README.md): collect
  in-game statistics from all the servers and makes it available to the
  Prometheus endpoint on the master server.
- [Subspace Storage](https://github.com/clusterio/factorioClusterioMod):
  Provide shared storage that can transport items between servers via
  teleport chests.
- [Player Auth](/plugins/player_auth/README.md): Provides authentication
  to the cluster via logging into a Factorio server.

There's also plugins developed and maintained by the community:

- [Discord Bridge](https://github.com/Hornwitser/discord_bridge):
  Bridges chat between instances and Discord.  By Hornwitser.
- [Server Select](https://github.com/Hornwitser/server_select):
  In-game GUI for connecting to other server in the cluster.  Originally
  by Godmave, ported to 2.0 by Hornwitser.

Want to make your own plugin?  Check out the documentation on [Writing
Plugins](/docs/writing-plugins.md) for where to start.


## Ubuntu setup

**Warning**: These instructions are for the unstable master version and is not
recommended for use, see [the 1.2.x branch][1.2.x] for how to install the stable version.

Clusterio runs on Node.js v12 and up, and v10.16.0+.  Node.js itself is not
supported on EOL Ubuntu releases so make sure you're on a recent release of Ubuntu.

Master and all slaves:

    wget -qO - https://deb.nodesource.com/setup_12.x | sudo -E bash -
    sudo apt install -y nodejs
    mkdir clusterio
    cd clusterio
    npm init -y
    npm install @clusterio/master @clusterio/slave @clusterio/ctl
    wget -O factorio.tar.gz https://www.factorio.com/get-download/latest/headless/linux64
    tar -xf factorio.tar.gz

downloads and installs nodejs, git and clusterio. To specify a version, change "latest" in the link to a version number like 0.14.21.

**Ubuntu with Docker**

The Docker support for Clusterio is curently broken.  If you need it
open an issue about it.

<!--
Clusterio has *very* limited support for using docker.

    sudo docker build -t clusterio --no-cache --force-rm factorioClusterio

	sudo docker run --name master -e MODE=master -p 1234:8080 -d -it --restart=unless-stopped danielvestol/clusterio

	sudo docker run --name slave -e MODE=slave -e INSTANCE=world1 -v /srv/clusterio/instances:/factorioClusterio/instances -p 1235:34167 -it --restart=unless-stopped danielvestol/clusterio

The -v flag is used to specify the instance directory. Your instances (save files etc) will be stored there.
-->

## Windows setup

**Warning**: These instructions are for the unstable master version and is not
recommended for use, see [the 1.2.x branch][1.2.x] for how to install the stable version.

**Requirements**

download and install nodeJS 12 from http://nodejs.org.  Clusterio runs on Node.js v12 and
up, and v10.16.0+.

**Master**

1. Open PowerShell or Command prompt in the directory you want to install to and run the following commands.

        mkdir clusterio
        cd clusterio
        npm init -y
        npm install @clusterio/master @clusterio/slave @clusterio/ctl

2. Obtain Factorio by either of these two methods:

    - Via the stand alone version on from their website

        1.  Create a new folder named "factorio" in the the factorioClusterio
            folder.

        2.  Download the MS Windows (64-bit zip package) from
            https://www.factorio.com/download .

        3.  Open the zip file and drag the folder called "Factorio_x.y.z" into
            the factorio folder created in step 1.

    - Via steam installation

        1.  Create a new folder named "factorio" in the the factorioClusterio
            folder.

        2.  Locate the game files by right clicking the game in steam,
            selecting properties, then Local Files, then Browse local files.

        3.  Go to the parent folder of the folder that Steam opened and copy
            the Factorio folder into the factorio folder created in step 1.


## Installing Plugins

Installing plugins to make them work with Clusterio consists of two
steps.  First install the package via npm, for example

    npm install @clusterio/plugin-subspace_storage

Then tell clusterio that this plugin exists by adding it as a plugin.

    npx clusteriomaster plugin add @clusterio/plugin-subspace_storage

This adds it to the default `plugin-list.json` file which in the shared
folder setup is loaded by master, slave and ctl.  If you have slaves or
ctl installed on separate computers (or directories) then you need to
repeat the plugin install process for all of them.  The clusteriomaster,
clusterioslave and clusterioctl commands has the plugin sub-command
so you do not need to install clusteriomaster to add plugins.

For development purposes the `plugin add` command supports adding
plugins by the absolute path to them, or a relative path that must start
with either . or .. (which will then be resolved to an absolute path).


## Configure Master Server

By default the master server will listen for HTTP on port 8080.  You can
change the port used with the command

    npx clusteriomaster config set master.http_port 1234

If you plan to make your cluster available externally set the address
that it will be accessible under with, for example

    npx clusteriomaster config set master.external_address http://203.0.113.4:1234/

Change the url to reflect the IP, protocol, and port the master server
is accessible under, dns names are also supported.  If you're planning
on making the master server accessible on the internet it's recommended
to set up TLS, see the [Setting Up TLS](/docs/setting-up-tls.md)
document for more details.

You can list the config of the master server with the `npx
clusteriomaster config list` command.  See the [readme for
@clusterio/master](/packages/master/README.md) for more
information.


### Setting up an admin account

Before you can manage the cluster you need to bootstrap an admin account
for it.  Replace `<username>` with your Factorio username (do not make
up a new username here).

    npx clusteriomaster bootstrap create-admin <username>
    npx clusteriomaster bootstrap create-ctl-config <username>

The first command creates a user account with the given name and
promotes it to a cluster admin.  The second one sets up a
`config-control.json` config for clusterioctl to connect to the master
server under the given user account.


## Running Clusterio

After following the installation and master configuration instructions
you can use the following commands to run Clusterio.


### Master Server

It's necessary to run the master server in order for anything to work.
Once you've completed the setup run the following command to start it
up:

    npx clusteriomaster run


### Slaves

Slaves connect to the master server and are managed remotely from the
master server.  In order for slaves to connect to the master server they
need a valid authentication token, you can create a slave config with
a valid token with the following command.

    npx clusterioctl slave create-config --name Local --generate-token

This will write a new `config-slave.json` file in the current directory
(you can change the location with the `--output` option) with the name,
token and url to connect to the master server with.  If you are making
the config for a remote slave you will need to have set the
`master.external_address` option to the URL the master server can be
reached on.

You can list the config of a slave on the slave itself with the `npx
clusterioslave config list` command.  See the [readme for
@clusterio/slave](/packages/slave/README.md) for more information.

Once the config is set up run the slave with

    npx clusterioslave run


### Instances

Instances are created, managed and started from the master server.  For
now the only interface available is the `clusterioctl` command line tool
included in Clusterio.  You can run this tool from any slave, or the
master server without having to set up a config, if you want to manage
the cluster from somewhere else you will need to set the
`control.master_url` and `control.master_token` options with the  `node
clusterioctl control-config set` command:

The basic operations to start a new instance is the following

    npx clusterioctl instance create "My instance"
    npx clusterioctl instance assign "My instance" "Local"
    npx clusterioctl instance start "My instance"

The first line creates the instance configuration on the master server.
The second assigns the instance to a slave which creates the instance
directory and files needed to run the instance on the given slave.  The
third line starts the instance, which creates a new save if there are no
save games present.

There are many more commands available with clusterioctl.  See the
[Managing a Cluster](/docs/managing-a-cluster.md) document or
`npx clusterioctl --help` for a full list of them.


## Common problems

### EACCESS [...] LISTEN 443

Some systems don't let non root processes listen to ports below 1000. Either run with `sudo` or change config.json to use higher port numbers.

According to [this link](https://askubuntu.com/questions/839520/open-port-443-for-a-node-web-app) if you manually installed node.js following the above instructions, you may need to run the following command to fix this issue:

    sudo setcap 'cap_net_bind_service=+ep' $(readlink -f $(which node))

### Portforwarding doesn't work on the master server when running under WSL

If you follow the ubuntu guide on WSL (Windows Subsystem for Linux, Bash on Ubuntu on Windows specifically), you will find that the website works on localhost and on your local ip, but not on the global ip. This is also true when you correctly port-forwarded the correct ports. Even when routing this server through nginx in WSL, the issue persists. Then, on a hunch, I tried to run nginx from windows itself and found that this DID work. It came to me that the only usage difference between the 2 versions of nginx is that I got a Windows Firewall popup.

TLDR: the tested fix is:

- open your windows firewall and go to advanced settings

- click on inbound rules and click on new rule...

- select port and click next >

- select TCP and select specific local ports and type in the ports that you want to open (comma separated) and click next > 3 times

- give the rule a name (like 'web server' or something), give it a description (optionally) and click finish
