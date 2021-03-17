# Managing a Cluster

Clusterio clusters are managed through the master server by using the `clusterioctl` command line interface which is invoked by running `npx clusterioctl <command>` in the clusterio directory.
This document uses the shorthand `ctl> foo` to indicate `npx clusterioctl foo` should be executed.
Mandatory parameters are shown in `<angles bracket>` and optional pameters are in `[square brackets]`.

Before `clusterioctl` can be used it needs to be configured for the cluster it will connect to.
The easiest way to do this is to run `npx clusteriomaster bootstrap create-ctl-config <username>` on the master server, which creates the necessary `config-control.json` for managing the cluster as the given user.


## Slaves

To be written.


## Instances

To be written.


## Users

Clusterio automatically creates user accounts for all players that join an instance when save patching is enabled.
These accounts are used to store per player data shared between instances, like if the player should be whitelisted, admin or banned.

### List users

    ctl> user list

Lists all user accounts in the cluster along with some data for each.


### Create User

    ctl> user create <name>

Creates a new empty user account for the given Factorio player.
Note that case matters here.
This is usually not required as user accounts are created automatically for players that join instances with save patching enabled.


### Promote User to Server Admin

    ctl> user set-admin <name> [--revoke] [--create]

Promotes the user given to in-game admin on instances with the `sync_adminlist` option enabled.
If the `--revoke` switch is used the user is removed from the adminlist.

Since admin status is a part of the account data the account must exist for this to succeed, passing `--create` will create the account if it does not exist.

**Note:** Being a server admin does not grant any access to manage the cluster.
See [set-roles](#set-cluster-roles) for adding roles which grant access to managing the clusetr.


### Whitelist User

    ctl> user set-whitelisted <name> [--remove] [--create]

Add the user given to the whitelist on instances with the `sync_whitelist` option enabled.
If the `--remove` switch is used the user is removed from the whitelist.

Since whitelisted status is a part of the account data the account must exist for this to succeed, passing `--create` will create the account if it does not exist.


### Ban User

    ctl> user set-banned <name> [--reason <message>] [--pardon] [--create]

Ban user in-game from instances with the `sync_banlist` option enabled.
Reason is a message that will be shown to the user when attemption to log in.
If the `--pardon` switch is used it removes the ban.

Since ban status is a part of the account data the account must exist for this to succeed, passing `--create` will create the account if it does not exist.

Note: This bans the user from logging in to Factorio servers in the cluster, it does not revoke access to any cluster management they might have, see next section on setting roles for revoking tha.


### Set Cluster Roles

    ctl> user set-roles <name> [roles...]

Replaces the roles the user has in the cluster with a new list of roles.
Calling with an empty roles argument will remove all roles from the user.

By default there's a roled named Cluster Admin which grants access to everything and a role named Player which grants a limited read access to the cluster, see [the section on roles](#roles) for more information about setting up roles and permissions.


### Delete user

    ctl> user delete <name>

Deletes everything stored on the master server for this user.

Note: If the player is banned from the cluster this will effectively unban them, as the ban status is stored with the user account.

Note: If the player joins the cluster again a new account will be made for them automatically.


## Roles

To be written.
