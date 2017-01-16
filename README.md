#factorioClusterio

Features:

- Entities to send/recieve items

- Cross dimensional storage

- Sending of liquids

- Sending of circuit network signals

Connection diagram:

![http://i.imgur.com/7FdVfgB.png](http://i.imgur.com/7FdVfgB.png)

There can be any number of clients connected to each slave, and any sumber of slaves connected to a master but there can only be one master server.

#Windows setup

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

To connect to a master server running on a remote machine, open config.json with your favourite text editor (notepad++). You can also set it up to use the official server browser server.

Change masterIP to something like 31.152.123.14 (provided by master server owner)

Change masterPort to something like 8080 (provided by master server owner)

Repeat step 3 for more servers on one machine. You should be able to find its port by looking at the slave section on master:8080 (the web interface)

**GameClient**

Alternative experimental client that may be broken: [clusterioClient](https://github.com/Danielv123/factorioClusterioClient)

1. Download the same version of the mod as the slave is running from [the mod portal](https://mods.factorio.com/mods/Danielv123/clusterio) or [github](https://github.com/Danielv123/factorioClusterioMod

2. Drop it into ./factorio/mods

3. Run factorio and connect to slave as a normal MP game. You will find the port number to connect to at http://[masterAddress]:8080

#Ubuntu setup

NodeJS does not support EOL ubuntu releases. Make sure you are on the most recent LTS release or newer.

Master and all slaves:

    sudo curl -sL https://deb.nodesource.com/setup_7.x | sudo -E bash - && sudo apt install -y git nodejs && git clone https://github.com/Danielv123/factorioClusterio.git && cd factorioClusterio && npm install && curl -o factorio.tar.gz -L https://www.factorio.com/get-download/latest/headless/linux64 && tar -xvzf factorio.tar.gz

downloads and installs nodejs, git and clusterio. To specify a version, change "latest" in the link to a version number like 0.14.21.

**Master**

    node master.js
    
**Server Host**
    
To download the mod for all its non vanilla features and items, (optional)

    node client.js download
    
    node client.js start [instancename]
	
use `nano config.json` to change settings.
