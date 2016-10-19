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

To start master, clone the repo and do

    node master.js

The clusterio monitoring interface can be found on [master]:8080

**Slave**

To install a Slave, you need to set up config.json.

clientIP should be localhost

clientPort and password should be the port and password you have configured for RCON connections when launching factorio.exe. The defaults are correct if you are using a modified version of the included launchEverything.bat.

factorioDirectory is the location of your factorio server folder, ex factorio_0.13.37. You HAVE to use the zip version downloaded from the website to use clusterio. Headless should also work.

masterIP and port should be selfexplanatory. To test if these settings works, open a browser on the slave system and enter masterIP:masterPort.

Once finished, do

    [factorioDirectory]/bin/x64/factorio.exe [flags]
    node client.js
	
See launchEverything.bat for example command.
