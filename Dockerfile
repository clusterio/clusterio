FROM node:20 as subspace_storage_builder
RUN apt update && apt install -y git
WORKDIR /
RUN git clone https://github.com/clusterio/subspace_storage.git
WORKDIR /subspace_storage
RUN npm install \
&& node build

FROM node:20 as clusterio_builder
RUN apt update \
&& apt install -y wget \
&& mkdir /clusterio
WORKDIR /clusterio
RUN wget -q -O factorio.tar.gz https://www.factorio.com/get-download/latest/headless/linux64 && tar -xf factorio.tar.gz && rm factorio.tar.gz
# Copy project files into the container
COPY . .

RUN pnpm install

# Install plugins. This is intended as a reasonable default, enabling plugins to make for fun gameplay.
# If you want a different set of plugins, consider using this as the base image for your own.
#RUN pnpm install @clusterio/plugin-subspace_storage
#RUN npx clusteriocontroller plugin add @clusterio/plugin-subspace_storage

COPY --from=subspace_storage_builder /subspace_storage/dist/ /clusterio/mods/

# Build Lua library mod
RUN node packages/lib/build_mod --build --source-dir packages/host/lua/clusterio_lib \
&& mv dist/* mods/ \
&& mkdir temp \
&& mkdir temp/test \
&& cp mods/ temp/test/ -r \
&& ls mods

# Remove node_modules
RUN find . -name 'node_modules' -type d -prune -print -exec rm -rf '{}' \;

FROM frolvlad/alpine-glibc AS clusterio_final

RUN apk add --update bash nodejs npm

COPY --from=clusterio_builder /clusterio /clusterio
WORKDIR /clusterio

# Install runtime dependencies
RUN pnpm install --production
LABEL maintainer "danielv@danielv.no"

FROM frolvlad/alpine-glibc AS clusterio_testing

RUN apk add --update bash nodejs npm

COPY --from=clusterio_builder /clusterio /clusterio
WORKDIR /clusterio

# Install runtime dependencies
RUN pnpm install
RUN pnpm install chalk semver
