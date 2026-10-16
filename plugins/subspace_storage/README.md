# Clusterio Subspace Storage Plugin

Plugin for the [Subspace Storage mod](https://github.com/clusterio/subspace_storage).


## Installation

Run the following commands in the folder Clusterio is installed to:

    npm install @clusterio/plugin-subspace_storage
    npx clusteriocontroller plugin add @clusterio/plugin-subspace_storage

Substitute clusteriocontroller with clusteriohost or clusterioctl if this a dedicate host or ctl installation respectively.


## Controller Configuration

### subspace_storage.division_method

How to divide items between instances when there isn't enough in storage to give everyone what they ask for.
One of `simple`, `dole` or `neural_dole`.
With `simple` requests are served in full on a first come first served basis until the storage runs out.
With `dole` a per item division factor is kept that halves the amount handed out each time a request can't be met and slowly recovers when requests succeed, which spreads the remaining items between instances at the cost of draining the last of an item slowly.
`neural_dole` does the same with a small neural network estimating a fair share from the recent request history.

Defaults to `simple`.


### subspace_storage.log_item_transfers

Log every item transfer in and out of the storage to the controller console at verbose level.

Defaults to `false`.


## Instance Configuration

### subspace_storage.log_item_transfers

Log every item transfer in and out of the storage to the host console at verbose level.

Defaults to `false`.


## Development: inventory updates

The Node sender is in [instance.ts](instance.ts); the Factorio receiver is `UpdateInvData` in the separate mod repository's [src/control.lua](https://github.com/clusterio/subspace_storage/blob/master/src/control.lua).
Check both ends when changing inventory synchronization.

Each entry is `[name, count, quality]` and replaces the absolute count for that name/quality pair; it is not an amount to add or subtract.
With `full=true`, the receiver clears the previous inventory before applying entries, so an empty full snapshot clears all old state.
Without `full=true`, entries update only the listed pairs; omitted pairs retain their previous values, and an explicit zero records a zero count.

A new or restarted instance needs a complete snapshot before incremental updates.
Keep a complete inventory cache separate from any latest-delta cache: one delta is not enough to initialize a new receiver, and changes across several update windows must not overwrite each other before delivery.
Verify empty snapshots, zero counts, multiple qualities, and consecutive deltas when changing this path.
