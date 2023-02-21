# Clusterio Player Auth Plugin

Plugin authenticating logged in players to the web interface.
Authentication is achieved by a simple challenge response mechanism where players have to log into one of the Factorio server in the cluster and open a dialog that presents a code, this code is input into the login form on the web interface which gives back a second code.
Once the player enters the second code into the dialog in-game the web interface is authenticated.


## Installation

Run the following commands in the folder Clusterio is installed to:

    npm install @clusterio/plugin-player_auth
    npx clusteriocontroller plugin add @clusterio/plugin-player_auth

Substitute clusteriocontroller with clusterioslave or clusterioctl if this a dedicate slave or ctl installation respectively.


## Controller Configuration

#### player_auth.code_length

Length in character of the generated challenge codes that need to be input between the web interface login form and the in-game Factorio login dialog.

Defaults to `6`.

#### player_auth.code_timeout

Time in seconds the first code generated stays valid.
The login must be completed in less than this time starting from when the login dialog is opened in-game.

Defaults to `120`.
