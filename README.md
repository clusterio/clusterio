# factorioClusterio [![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2FDanielv123%2FfactorioClusterio.svg?type=shield)](https://app.fossa.io/projects/git%2Bgithub.com%2FDanielv123%2FfactorioClusterio?ref=badge_shield)

If you want to connect to a clusterio cluster, please reffer to the [client](https://github.com/Danielv123/factorioClusterioClient)

Features:

- Entities to send/recieve items

- Cross dimensional storage

- Sending of liquids

- Sending of circuit network signals

Connection diagram:

![http://i.imgur.com/7FdVfgB.png](http://i.imgur.com/7FdVfgB.png)

There can be any number of clients connected to each slave, and any sumber of slaves connected to a master but there can only be one master server.

# Ubuntu setup

NodeJS does not support EOL ubuntu releases. Make sure you are on the most recent LTS release or newer.

Master and all slaves:

    sudo curl -sL https://deb.nodesource.com/setup_7.x | sudo -E bash - && sudo apt install -y git nodejs && git clone https://github.com/Danielv123/factorioClusterio.git && cd factorioClusterio && npm install && sudo npm install pm2 -g && curl -o factorio.tar.gz -L https://www.factorio.com/get-download/latest/headless/linux64 && tar -xvf factorio.tar.gz

downloads and installs nodejs, pm2, git and clusterio. To specify a version, change "latest" in the link to a version number like 0.14.21.

**Master**

    pm2 start master.js --name master
    
**Server Host**
    
To download the mod for all its non vanilla features and items, (optional)

    node client.js download

To create a new instance (its own save, set of mods and config files)

    node client.js start [instancename]

To launch an instance with pm2

    pm2 start --name slave client.js -- start [instancename]

use `nano config.json` to change settings.

**Ubuntu with Docker**

Clusterio has limited support for using docker.

    sudo docker build -t clusterio --no-cache --force-rm factorioClusterio
	
	sudo docker run --name master -e MODE=master -p 1234:8080 -d -it --restart=unless-stopped danielvestol/clusterio
	
	sudo docker run --name slave -e MODE=client -e INSTANCE=world1 -v /srv/clusterio/instances:/factorioClusterio/instances -p 1235:34167 -it --restart=unless-stopped danielvestol/clusterio

The -v flag is used to specify the instance directory. Your instances (save files etc) will be stored there.

# Windows setup

Clusterio is built up of multiple parts. Here is a quick guide:

Master = master.js

Server host (Slave) = client.js + factorio server

Game Client = The people connecting to the server

All Server Hosts (Slaves) AND Game Clients need to be running the clusterio mod located at [github](https://github.com/Danielv123/factorioClusterioMod) Install it by dropping it into the mods folder.

There are no requirements for other mods, they can be ran in any configuration allowed by the base game.

**Requirements**

download and install nodeJS 6+ from http://nodejs.org

download and install git from https://git-scm.com/

reboot when you are done, then proceed to the next steps. *reboots matter*

**Master**

1. download and run https://puu.sh/toFHl/01eebbb333.bat

2. You do not *need* to follow the given instructions, but you should

3. type `node master.js`

**Server Host**

1. download and run https://puu.sh/toFHl/01eebbb333.bat

2. Follow the instructions given

3. Type `node client.js start [instancename]` to create a new instance.

To connect to a master server running on a remote machine, open config.json with your favourite text editor (notepad++). You can also set it up to use the official server browser.

Change masterIP to something like 31.152.123.14 (provided by master server owner)

Change masterPort to something like 8080 (provided by master server owner)

Repeat step 3 for more servers on one machine. You should be able to find its port by looking at the slave section on master:8080 (the web interface)

**GameClient**

Fancy game client that does the following steps automatically: [clusterioClient](https://github.com/Danielv123/factorioClusterioClient)

1. Download the same version of the mod as the slave is running from [the mod portal](https://mods.factorio.com/mods/Danielv123/clusterio) or [github](https://github.com/Danielv123/factorioClusterioMod

2. Drop it into ./factorio/mods

3. Run factorio and connect to slave as a normal MP game. You will find the port number to connect to at http://[masterAddress]:8080
