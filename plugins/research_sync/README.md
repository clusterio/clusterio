# Clusterio Research Sync Plugin

Plugin synchronizing research progress between instances and the cluster.

## Research queue

Each server can follow one cluster research queue.
It is set from the normal research screen: queueing, moving or cancelling a technology there changes it for every following server.
So does a lab whose circuit "set research" picks a technology, and so can another mod.

The "Follow the cluster research queue" checkbox on the lab window turns this on or off per server.
Turning it on replaces the server's queue with the cluster's, or, if the cluster queue is empty, shares the server's queue as the cluster queue.
Turning it off clears the server's queue.
Flipping it prints a chat line on that server.
It is on by default.
The first server to turn following on with something queued shares its queue as the cluster queue, and servers that turn it on after that take the cluster's.
A server's first start counts as turning it on; a later restart takes the cluster queue, even an empty one.
Whenever the cluster queue is empty (for example, everything in it has finished), the next server that turns following on shares its queue again.
Every change to the cluster queue prints a chat line on every server.

It needs Factorio 2.0.56 or later, older servers ignore the queue.
To turn it off without the GUI, run `/sc research_sync.set_follow(false)` on that server.

Known gaps:

- A script that assigns the queue directly to `{}` isn't seen.
- Two following servers whose labs want different research keep flipping the cluster queue, as two labs do on one server.
- A technology a server can't queue yet is dropped there, and an edit on that server then drops it for everyone.


## Installation

Run the following commands in the folder Clusterio is installed to:

    npm install @clusterio/plugin-research_sync
    npx clusteriocontroller plugin add @clusterio/plugin-research_sync

Substitute clusteriocontroller with clusteriohost or clusterioctl if this a dedicate host or ctl installation respectively.
