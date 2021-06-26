FROM node:12 as subspace_storage_builder
RUN apt update && apt install -y git
WORKDIR /
RUN git clone https://github.com/clusterio/subspace_storage.git
WORKDIR /subspace_storage
RUN npm install \
&& node build

FROM node:12 as clusterio_builder
RUN apt update \
&& apt install -y wget \
&& mkdir /clusterio
WORKDIR /clusterio
RUN wget -q -O factorio.tar.gz https://www.factorio.com/get-download/latest/headless/linux64 && tar -xf factorio.tar.gz && rm factorio.tar.gz
# Copy project files into the container
COPY . .

RUN npm install \
&& npx lerna bootstrap --hoist

# Install plugins. This is intended as a reasonable default, enabling plugins to make for fun gameplay.
# If you want a different set of plugins, consider using this as the base image for your own.
#RUN npm install @clusterio/plugin-subspace_storage
#RUN npx clusteriomaster plugin add @clusterio/plugin-subspace_storage

COPY --from=subspace_storage_builder /subspace_storage/dist/ /clusterio/sharedMods/

# Build submodules (web UI, libraries, plugins etc)
RUN npx lerna run build
# Build Lua library mod
RUN node packages/lib/build_mod --build --source-dir packages/slave/lua/clusterio_lib \
&& mv dist/* sharedMods/ \
&& mkdir temp \
&& mkdir temp/test \
&& cp sharedMods/ temp/test/ -r \
&& ls sharedMods

# Remove node_modules
RUN find . -name 'node_modules' -type d -prune -print -exec rm -rf '{}' \;

FROM frolvlad/alpine-glibc AS clusterio_final

RUN apk add --update bash nodejs npm

COPY --from=clusterio_builder /clusterio /clusterio
WORKDIR /clusterio

# Install runtime dependencies
RUN npm install --production
RUN npx lerna bootstrap -- --production --no-optional
LABEL maintainer "danielv@danielv.no"

FROM frolvlad/alpine-glibc AS clusterio_testing

RUN apk add --update bash nodejs npm

COPY --from=clusterio_builder /clusterio /clusterio
WORKDIR /clusterio

# Install runtime dependencies
RUN npm install
RUN npx lerna bootstrap
RUN npm install chalk semver
