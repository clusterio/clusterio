Clusterio Statistics Exporter Plugin
====================================

Plugin exporting item production, fluid production, kill count, entity
build and pollution statistics to the Prometheus integration to
Clusterio.


Installation
------------

Run the following commands in the folder Clusterio is installed to:

    npm install @clusterio/plugin-statistics_exporter
    npx clusteriomaster plugin add @clusterio/plugin-statistics_exporter

Substitute clusteriomaster with clusterioslave or clusterioctl if this a
dedicate slave or ctl installation respectively.


Instance Configuration
----------------------

### statistics_exporter.command_timeout

Timeout in seconds to wait for the statitics gathering command to the
Factorio server return the result.  If the timeout is exceeded the
previous collected results are returned instead.  Normally the command
returns immediatly with the data, but if the RCON interface is
overloaded then the command may take too long to timely answer the
metrics collection request.

Defaults to `1`.
