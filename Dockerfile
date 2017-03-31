FROM node:latest
RUN apt-get update && apt install git -y && git clone https://github.com/Danielv123/factorioClusterio.git && cd factorioClusterio && npm install && curl -o factorio.tar.gz -L https://www.factorio.com/get-download/latest/headless/linux64 && tar -xvzf factorio.tar.gz

LABEL maintainer "danielv@live.no"

EXPOSE 8080 34167

VOLUME factorioClusterio/instances

WORKDIR factorioClusterio
CMD node $MODE\.js start $INSTANCE