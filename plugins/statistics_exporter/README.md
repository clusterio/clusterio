Clusterio Statistics Exporter Plugin
====================================

Plugin exporting item production, fluid production, kill count, entity
build and poluttion statistics to the Prometheus integration to
Clusterio.


Installation
============

Run the following commands in the folder Clusterio is installed to:

    npm install @clusterio/plugin-statistics_exporter
    npx clusteriomaster plugin add @clusterio/plugin-statistics_exporter

Substitute clusteriomaster with clusterioslave or clusterioctl if this a
dedicate slave or ctl installation respectively.
