# Remote Map

A clusterio plugin for remotely exploring and editing the factorio world

### Setup

Make a database for storing entities

    docker run --name some-mariadb -e MYSQL_ROOT_PASSWORD=clusterio-remote-map --restart=unless-stopped -d mariadb:latest

### Dev setup

Make a database container and expose the ports

    docker run -p 3306:3306 --name some-mariadb -e MYSQL_ROOT_PASSWORD=clusterio-remote-map -d mariadb:latest
