# Warning: This is currently broken as a result of
# changes done in the 2.0 refactoring.
FROM node:12
RUN apt-get update && apt install git curl tar -y
RUN mkdir factorioClusterio

RUN git clone -b master https://github.com/clusterio/factorioClusterio.git && cd factorioClusterio && npm install --only=production
RUN cd factorioClusterio && curl -o factorio.tar.gz -L https://www.factorio.com/get-download/latest/headless/linux64 && tar -xf factorio.tar.gz

WORKDIR factorioClusterio
RUN mkdir instances sharedMods
RUN cp config.json.dist config.json

RUN node client manage shared mods add clusterio

LABEL maintainer "Sir3lit@gmail.com"

EXPOSE 8080 34167
VOLUME /factorioClusterio/instances
VOLUME /factorioClusterio/sharedMods
VOLUME /factorioClusterio/sharedPlugins

CMD MODE="$MODE" node $MODE start $INSTANCE
