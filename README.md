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

Slave = client.js + factorio server

Client = The people connecting to the server

Master and all all Slaves have to be running nodejs. Get it from nodejs.org.

All Slaves AND Clients need to be running the clusterio mod located in this repository. Install it by dropping it into the mods folder.

There are no requirements for other mods, they can be ran in any configuration allowed by the base game.

**Master**

1. Download this repository

2.     npm install

3.     node master.js

**Slave**

1. Download this repository

2. Place your factorio server folder inside of factorioClusterio/, making it factorioClusterio/factorio

You can change the name and path expected in config.json if wanted.

3.     node client.js start [instancename]

Repeat step 3 for more servers on one machine. You should be able to find its port by looking at the console output or at the slave section on master:8080

**Client**

1. Download the same version of the mod as the slave is running

2. Drop it into ./factorio/mods

3. Run factorio and connect to slave as a normal MP game.

#Ubuntu setup

Master and all slaves:

    sudo curl -sL https://deb.nodesource.com/setup_7.x | sudo -E bash - && sudo apt install -y git nodejs && git clone https://github.com/Danielv123/factorioClusterio.git && cd factorioClusterio && npm install

downloads and installs nodejs, git and clusterio.

**Master**

    node master.js
    
**Slave**

Download factorio with curl. Make sure to insert the correct version number.

Start the slave with node client.js

    curl -o factorio.tar.gz -L https://www.factorio.com/get-download/0.14.21/headless/linux64 && tar -xvzf factorio.tar.gz
    
    node client.js start [instancename]
