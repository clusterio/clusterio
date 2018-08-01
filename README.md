# factorioClusterio

Discord for development/support/play: https://discord.gg/5XuDkje

### Ways to support me/the project:

* Contribute with code/documentation. Always nice to move the project forward

* Support me monetarily on [patreon](https://www.patreon.com/danielv123) or paypal: danielv@live.no

### Table of contents

* [Introduction & methodology](#introduction)

* [Ubuntu setup](#ubuntu-setup)

* [Windows setup](#windows-setup)

* [Common problems](#Common-problems)

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
    cp config.json.dist config.json
    node ./lib/npmPostinstall.js
	

downloads and installs nodejs, pm2, git and clusterio. To specify a version, change "latest" in the link to a version number like 0.14.21.

Now you need to edit the `config.json` file. If you skip this step nothing will work.
Pretty much all the blank fields should be filled in, except on the master where a few can be omitted.

* You get the `masterAuthToken` from `secret-api-token.txt` in the master install dir after running the master twice.

* You get your factorio matchmaking token from factorio.com

* The `masterAuthSecret` should never be touched unless you want to invalidate everyones authentication tokens

**Master**

    pm2 start master.js --name master
	
OR

    node master.js
    
**Server Host**
    
To download the mod for all its non vanilla features and items, (optional, but very recommended)

    node client.js manage shared mods add clusterio
	
To create a new instance (its own save, set of mods and config files)

    node client.js start [instancename]

To launch an instance with pm2

    pm2 start --name [instancename] client.js -- start [instancename]

use `nano config.json` to change settings.

**Ubuntu with Docker**

Clusterio has *very* limited support for using docker.

    sudo docker build -t clusterio --no-cache --force-rm factorioClusterio
	
	sudo docker run --name master -e MODE=master -p 1234:8080 -d -it --restart=unless-stopped danielvestol/clusterio
	
	sudo docker run --name slave -e MODE=client -e INSTANCE=world1 -v /srv/clusterio/instances:/factorioClusterio/instances -p 1235:34167 -it --restart=unless-stopped danielvestol/clusterio

The -v flag is used to specify the instance directory. Your instances (save files etc) will be stored there.

## Windows setup

Clusterio is built up of multiple parts. Here is a quick guide:

Master = master.js

Server host (Slave) = client.js + factorio server

Game Client = The people connecting to the server

**Requirements**

download and install nodeJS 8 or 9 from http://nodejs.org

download and install git from https://git-scm.com/

reboot when you are done, then proceed to the next steps. *reboots matter*

**Master**

1. download and run https://puu.sh/toFHl/01eebbb333.bat

2. Copy config.json.dist to config.json

3. Follow the instructions in the bat file
3. Some of the instructions are outdated. If you get stuck somewhere, look at the Ubuntu section.

4. Run `node client.js manage shared mods add clusterio`

5. type `node master.js` to start the server

**Server Host**

1. download and run https://puu.sh/toFHl/01eebbb333.bat

2. Copy config.json.dist to config.json

3. Follow the instructions given. 

3.5 Some of the instructions are outdated. If you get stuck somewhere, look at the Ubuntu section.

4. Type `node client.js start [instancename]` to create a new instance.

To connect to a master server running on a remote machine, open config.json with your favourite text editor (notepad++). You can also set it up to use the official server browser.

Change `masterIP `to something like `31.152.123.14` (provided by master server owner)

Change `masterPort` to something like `8080` (provided by master server owner)

Change `masterAuthToken` to the value found in `secret-api-token.txt` on the master server

Repeat step 4 for more servers on one machine. You should be able to find its port by looking at the slave section on master:8080 (the web interface)

**GameClient**

Fancy game client that does the following steps automatically, but is really old so be warned: [clusterioClient](https://github.com/Danielv123/factorioClusterioClient)

1. Download the same version of the mod as the slave is running from [the mod portal](https://mods.factorio.com/mods/Danielv123/clusterio) or [github](https://github.com/Danielv123/factorioClusterioMod

2. Drop it into ./factorio/mods

3. Run factorio and connect to slave as a normal MP game. You will find the port number to connect to at http://[masterAddress]:8080

## Common problems

### Cannot find module: `/../../config`

Copy your config.json.dist to config.json and configure it.

### EACCESS [...] LISTEN 443

Some systems don't let non root processes listen to ports below 1000. Either run with `sudo` or change config.json to use higher port numbers.

### Other fixes for other potential problems:

Sometimes the install fails. Try `node ./lib/npmPostinstall.js` to complete it.


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
node client.js manage shared mods add clusterio
```
