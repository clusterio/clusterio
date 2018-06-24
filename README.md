# factorioClusterio
[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2FDanielv123%2FfactorioClusterio.svg?type=shield)](https://app.fossa.io/projects/git%2Bgithub.com%2FDanielv123%2FfactorioClusterio?ref=badge_shield)

| Branch | Coverage | Build |
|--------|----------| ----- |
| Master | [![codecov](https://codecov.io/gh/Danielv123/factorioClusterio/branch/master/graph/badge.svg)](https://codecov.io/gh/Danielv123/factorioClusterio) | [![Build Status](https://travis-ci.org/Danielv123/factorioClusterio.svg?branch=master)](https://travis-ci.org/Danielv123/factorioClusterio) |
| Dev    | [![codecov](https://codecov.io/gh/Danielv123/factorioClusterio/branch/dev/graph/badge.svg)](https://codecov.io/gh/Danielv123/factorioClusterio) | [![Build Status](https://travis-ci.org/Danielv123/factorioClusterio.svg?branch=dev)](https://travis-ci.org/Danielv123/factorioClusterio) |

If you want to connect to a clusterio cluster, please reffer to the [client](https://github.com/Danielv123/factorioClusterioClient)

### Table of contents

* [Introduction & methodology](#introduction)

* [Ubuntu setup](#ubuntu-setup)

* [Windows setup](#windows-setup)

* [Command cheatsheet](#cheatsheet)

## Introduction

Features:

- Entities to send/recieve items

- Cross dimensional storage

- Sending of liquids

- Sending of circuit network signals

- Inventory combinator to display item levels in the cluster (and epoch time)

- Reporting of graphs and UPS on master interface

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

This process works the same for both items and liquids, independant on what mods are used. Yes, modded items are fully supported.

Clusterio also handles a few other neat things, such as giving you access to epoch time, transmitting combinator signals between worlds (and any other application who wants to) and 
creating graphs on the master web interface.

## Ubuntu setup

NodeJS does not support EOL ubuntu releases. Make sure you are on the most recent LTS release or newer.

Master and all slaves:

    sudo curl -sL https://deb.nodesource.com/setup_9.x | sudo -E bash -
    sudo apt install -y nodejs python-dev git wget curl tar build-essential
    sudo npm install pm2 -g
    git clone https://github.com/Danielv123/factorioClusterio.git
    cd factorioClusterio
    curl -o factorio.tar.gz -L https://www.factorio.com/get-download/latest/headless/linux64
    tar -xf factorio.tar.gz
    npm install
    node ./lib/npmPostinstall.js

downloads and installs nodejs, pm2, git and clusterio. To specify a version, change "latest" in the link to a version number like 0.14.21.

*Copy config.json.dist to config.json* - Otherwise it will crash, as you'd expect.

**Master**

    pm2 start master.js --name master
    
**Server Host**
    
To download the mod for all its non vanilla features and items, (optional)

    node client.js manage shared mods add clusterio
	
Add the master API key, found in the masters install directory (secret-api-token.txt) to your config.json masterAuthToken field

To create a new instance (its own save, set of mods and config files)

    node client.js start [instancename]

To launch an instance with pm2

    pm2 start --name [instancename] client.js -- start [instancename]

use `nano config.json` to change settings.

**Ubuntu with Docker**

Clusterio has limited support for using docker.

    sudo docker build -t clusterio --no-cache --force-rm factorioClusterio
	
	sudo docker run --name master -e MODE=master -p 1234:8080 -d -it --restart=unless-stopped danielvestol/clusterio
	
	sudo docker run --name slave -e MODE=client -e INSTANCE=world1 -v /srv/clusterio/instances:/factorioClusterio/instances -p 1235:34167 -it --restart=unless-stopped danielvestol/clusterio

The -v flag is used to specify the instance directory. Your instances (save files etc) will be stored there.

## Windows setup

Clusterio is built up of multiple parts. Here is a quick guide:

Master = master.js

Server host (Slave) = client.js + factorio server

Game Client = The people connecting to the server

All Server Hosts (Slaves) AND Game Clients need to be running the clusterio mod located at [github](https://github.com/Danielv123/factorioClusterioMod) Install it by dropping it into either the sharedMods folder or instances/[instanceName]/instanceMods folder.

There are no requirements for other mods, they can be ran in any configuration allowed by the base game.

**Requirements**

download and install nodeJS 6+ from http://nodejs.org

download and install git from https://git-scm.com/

reboot when you are done, then proceed to the next steps. *reboots matter*

**Master**

1. download and run https://puu.sh/toFHl/01eebbb333.bat

2. Copy config.json.dist to config.json

3. You do not *need* to follow the given instructions, but you should

4. type `node master.js`

**Server Host**

1. download and run https://puu.sh/toFHl/01eebbb333.bat

2. Copy config.json.dist to config.json

3. Follow the instructions given

4. Type `node client.js start [instancename]` to create a new instance.

To connect to a master server running on a remote machine, open config.json with your favourite text editor (notepad++). You can also set it up to use the official server browser.

Change masterIP to something like 31.152.123.14 (provided by master server owner)

Change masterPort to something like 8080 (provided by master server owner)

Repeat step 3 for more servers on one machine. You should be able to find its port by looking at the slave section on master:8080 (the web interface)

**GameClient**

Fancy game client that does the following steps automatically: [clusterioClient](https://github.com/Danielv123/factorioClusterioClient)

1. Download the same version of the mod as the slave is running from [the mod portal](https://mods.factorio.com/mods/Danielv123/clusterio) or [github](https://github.com/Danielv123/factorioClusterioMod

2. Drop it into ./factorio/mods

3. Run factorio and connect to slave as a normal MP game. You will find the port number to connect to at http://[masterAddress]:8080

## Cheatsheet

**To create a new instance/start it**

    node client.js start [instanceName]

**Other instance management tools:**
```
node client.js delete [instanceName]
node client.js list
```
**To update clusterio to the latest version:**

1. Download the latest zip version of factorio for your platform manually from factorio.com. Place it in the project root folder and call it "factorio" (folder name is specified in config.json)

2. Grab the latest version of the repo

```
git pull

npm install
```

3. Download the latest version of the factorioClusterioMod from its github repo
```
node client.js download
```
