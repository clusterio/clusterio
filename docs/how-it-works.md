Save Patching
-------------

In order to efficiently get data in and out of running Factorio servers
and to provide custom interfaces Clusterio uses save
patching<sup>[1]</sup> to add code to the game.  The save patching is
based on the built in
[event_handler](https://github.com/wube/factorio-data/blob/master/core/lualib/event_handler.lua)
library to Factorio and requires scenarios to be coded specifically for
it.  Mods on the other hand work without modifications.

<sub>1: Before version 2.0 of Clusterio this was done at runtime
with a patcher called Hotpatch, but due to the difficulty in supporting
run time patching and the lack of documentation it was replace it with
save patching instead.</sub>
