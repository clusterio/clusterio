<img src="./logo.svg" width="100%" align="right">

<br/>
<br/>
<br/>

# factorioClusterio

Discord for development/support/play: https://discord.gg/5XuDkje

## Important notice

**WARNING: The master branch is currently broken, do not use it!**

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

* [Introduction & methodology](#introduction)
* [Ubuntu setup](#ubuntu-setup)
* [Windows setup](#windows-setup)
* [Running Clusterio](#running-clusterio)
  * [Master Server](#master-server)
  * [Slaves](#slaves)
  * [Instances](#instances)
* [Optional plugins](#Plugins)
* [Common problems](#Common-problems)

## Introduction

Features:

- Entities to send/recieve items

- Cross dimensional storage

- Sending of liquids

- Sending of circuit network signals

- Inventory combinator to display item levels in the cluster (and epoch time)

- Reporting of graphs and UPS on master interface (Also has extensive Prometheus reporting)

Optional extras (see [Plugins](#Plugins))

- Have your inventory synchronize across servers

- Teleport trans from the border of one world to te next

- Show in-game chat in discord


Connection diagram:

![http://i.imgur.com/7FdVfgB.png](http://i.imgur.com/7FdVfgB.png)

There can be any number of clients connected to each slave, and any number of slaves connected to a master but there can only be one master server in each cluster.

**How does it work?**

Traditional factorio mods have always been limited by the games deterministic design. This gives us a very bug free and predictable game, but doesn't allow us cool stuff such as internet communication.
Clusterio exploits one of the games logging features, game.write_file and RCON to communicate between servers. Sending an item from one server to another takes this path:

1. server1: Chest has stuff in it, write the contents to a file and delete them from the game world

2. client.js on server1: File has stuff in it, parse and send to the master for storage

3. master: server1 gave us stuff, store it in the storage and write some statistics

4. server2: get-chest is empty, write a request to file

5. client.js on server2: Request file has stuff in it, parse and send a request to master for more items of that type

6. master: server2 asked for stuff, check if we have enough and how much demand there is, then send however much is appropriate back

7. client.js on server2: We were allowed to import x of item y, run command /c remote.call("clusterio", "importMany", "{'copper-plate':120}")

This process works the same for both items and liquids, independent on what mods are used. Yes, modded items are fully supported.

Clusterio can also do a few other neat things, such as giving you access to epoch time, syncing player inventories between servers, keeping track of playtime (playerManager plugin), teleporting trains between servers (trainTeleports) and exporting tons of factorio related statistics to Prometheus for graphing in grafana.

## Ubuntu setup

**Warning**: These instructions are for the unstable master version and is not
recommended for use, see [the 1.2.x branch][1.2.x] for how to install the stable version.

Clusterio runs on Node.js v12 and up, v11.13.0+ and v10.16.0+.  Node.js itself is not
supported on EOL Ubuntu releases so make sure you're on a recent release of Ubuntu.

Master and all slaves:

    wget -qO - https://deb.nodesource.com/setup_12.x | sudo -E bash -
    sudo apt install -y nodejs python-dev git build-essential
    git clone -b master https://github.com/clusterio/factorioClusterio.git
    cd factorioClusterio
    wget -O factorio.tar.gz https://www.factorio.com/get-download/latest/headless/linux64
    tar -xf factorio.tar.gz
    npm install --only=production

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

Clusterio is built up of multiple parts. Here is a quick guide:

Master = master.js

Server host (Slave) = slave.js + factorio server

Game Client = The people connecting to the server

**Requirements**

download and install nodeJS 12 from http://nodejs.org.  Clusterio runs on Node.js v12 and
up, v11.13.0+ and v10.16.0+.

download and install git from https://git-scm.com/

reboot when you are done, then proceed to the next steps. *reboots matter*

**Master**

1. Open PowerShell or Command prompt in the directory you want to install to and run the following commands.

        git clone -b master https://github.com/clusterio/factorioClusterio
        cd factorioClusterio
        npm install --only=production

2. Obtain Factorio by either of these two methods:

    - Via the stand alone version on from their website

        1.  Create a new folder named "factorio" in the the factorioClusterio
            folder.

        2.  Download the MS Windows (64-bit zip package) from
            https://www.factorio.com/download .

        3.  Open the zip file and drag the folder called "Factorio_0.x.y" into
            the factorio folder created in step 1.

    - Via steam installation

        1.  Create a new folder named "factorio" in the the factorioClusterio
            folder.

        2.  Locate the game files by right clicking the game in steam,
            selecting properties, then Local Files, then Browse local files.

        3.  Go to the parent folder of the folder that Steam opened and copy
            the Factorio folder into the factorio folder created in step 1.


## Running Clusterio

After following the installation instructions you can use the following
commands to run Clusterio.


### Master Server

It's necessary to run the master server in order for anything to work.
Once you've completed the setup run the following command to start it
up:

    node master run


### Slaves

Slaves connect to the master server and are managed remotely from the
master server.  In order for slaves to connect to the master server they
need an authentication token from the master server.  This token is
written to secret-api-token.txt on the master server when it is started
up.

To set up the configuration for a new local slave run the following.

    node slave config set slave.name "Local"
    node slave config set slave.master_token "<token>"

This will write a new `config-slave.json` file in the current directory
(you can change the location with the `--config` option) with the name
and token provided.  If you are connecting to a remote master server you
will also need to set the `slave.master_url` option to that url.

You can list the config of a slave with the `node slave config list`
command.  Use `node slave config --help` for more information.

Once the config is set up run the slave with

    node slave run


### Instances

Instances are created, managed and started from the master server.  For
now the only interface available is the `clusterctl` command line tool
included in Clusterio.  You can run this tool from any slave, or the
master server without having to set up a config, if you want to manage
the cluster from somewhere else you will need to set the
`control.master_url` and `control.master_token` options with the  `node
clusterctl control-config set` command:

The basic operations to start a new instance is the following

    node clusterctl create-instance --name "My instance"
    node clusterctl assign-instance --instance "My instance" --slave "Local"
    node clusterctl start-instance --instance "My instance"

The first line creates the instance configuration on the master server.
The second assigns the instance to a slave which creates the instance
directory and files needed to run the instance on the given slave.  The
third line starts the instance, which creates a new save if there are no
save games present.

There are many more commands available with clusterctl.  See
`node clusterctl --help` for a full list of them.


## Plugins
Here are the known Clusterio plugins in the wild:
1. [Player Manager](https://github.com/Danielv123/playerManager) - Adds player management to the Web UI and shared inventory handling (beta)
2. [DiscordChat](https://github.com/jakedraddy/ClusterioDiscordChat) - Logs in-game chat/joins/leave messages on all instances to a Discord webhook.
3. [TrainTeleports](https://github.com/Godmave/clusterioTrainTeleports) - Allows you to teleport cargotrains between servers.

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

### Other fixes for other potential problems:

Sometimes the install fails. Try `node ./lib/npmPostinstall` to complete it.
