# First stage builds the application
ARG NODE_VERSION=14
ARG OS=ubi8

#### Stage BASE ########################################################################################################
# FROM ${ARCH}/node:${NODE_VERSION}-${OS} AS base
FROM registry.redhat.io/${OS}/nodejs-${NODE_VERSION} as base

# Copy scripts
COPY scripts/*.sh /tmp/
RUN ls /tmp/

# Install tools, create Node-RED app and data dir, add user and set rights
# RUN set -ex && \
#    apt-get update && apt-get install -y \
#        bash \
#        tzdata \
#        curl \
#        nano \
#        wget \
#        git \
#        openssl \
#        openssh-client \
#        ca-certificates && \
#    mkdir -p /opt/app-root/src/.node-red /data && \
#    deluser --remove-home node && \
#    adduser -h /opt/app-root/src/.node-red -D -H node-red -u 1000 && \
#    chown -R node-red:root /data && chmod -R g+rwX /data && \
#   chown -R node-red:root /opt/app-root/src/.node-red && chmod -R g+rwX /opt/app-root/src/.node-red

# Set work directory
WORKDIR /opt/app-root/src/.node-red

# Setup SSH known_hosts file
COPY known_hosts.sh .
RUN ./known_hosts.sh /etc/ssh/ssh_known_hosts && \
    rm /opt/app-root/src/.node-red/known_hosts.sh

# package.json contains Node-RED NPM module and node dependencies
COPY package.json .
COPY flows.json /data
COPY settings.js /data
RUN ls /data

#### Stage BUILD #######################################################################################################
FROM base AS build

# Install Build tools
RUN apk add --no-cache --virtual buildtools build-base linux-headers udev python2 && \
    npm install --unsafe-perm --no-update-notifier --no-fund --only=production && \
    chmod 775 /tmp/remove_native_gpio.sh && \ 
    /tmp/remove_native_gpio.sh && \
    cp -R node_modules prod_node_modules

#### Stage RELEASE #####################################################################################################
FROM base AS RELEASE
ARG BUILD_DATE
ARG BUILD_VERSION
ARG BUILD_REF
ARG NODE_RED_VERSION
ARG ARCH
ARG TAG_SUFFIX=default

LABEL org.label-schema.build-date=${BUILD_DATE} \
    org.label-schema.docker.dockerfile="Dockerfile.oracle" \
    org.label-schema.license="Apache-2.0" \
    org.label-schema.name="Node-RED" \
    org.label-schema.version=${BUILD_VERSION} \
    org.label-schema.description="Low-code programming for event-driven applications." \
    org.label-schema.url="https://nodered.org" \
    org.label-schema.vcs-ref=${BUILD_REF} \
    org.label-schema.vcs-type="Git" \
    org.label-schema.vcs-url="https://git.puma.corp.telstra.com/virtual-operator/virtual-operator-core-docker"


COPY --from=build /opt/app-root/src/.node-red/prod_node_modules ./node_modules

# Add the VO custom nodes
RUN mkdir -p /node_modules/@node-red/nodes/core/vo
COPY /nodes/ /node_modules/@node-red/nodes/core/vo
RUN ls /node_modules/@node-red/nodes/core/vo

# Chown, install devtools & Clean up
RUN chown -R node-red:root /opt/app-root/src/.node-red && \
    chmod 775 /tmp/install_devtools.sh && \ 
    /tmp/install_devtools.sh && \
    rm -r /tmp/*

USER node-red

# Env variables
ENV NODE_RED_VERSION=$NODE_RED_VERSION \
    NODE_PATH=/opt/app-root/src/.node-red/node_modules:/data/node_modules \
    PATH=/opt/app-root/src/.node-red/node_modules/.bin:${PATH} \
    FLOWS=flows.json

# ENV NODE_RED_ENABLE_SAFE_MODE=true    # Uncomment to enable safe start mode (flows not running)
# ENV NODE_RED_ENABLE_PROJECTS=true     # Uncomment to enable projects option

# Expose the listening port of node-red
EXPOSE 1880

# Installing Oracle Instant Client to be able to access oracle db on node-red

# Change user to root to prevent permission denied
USER root

ENV LD_LIBRARY_PATH=/lib

# Add your database nls_lang to avoid "not a valid month" error.
# ENV NLS_LANG="American_America.WE8ISO8859P1" # Uncomment to enable, default is American_America.WE8ISO8859P1

COPY libs/instantclient-basic-linuxx64.zip .
RUN unzip instantclient-basic-linuxx64 && \
    cp -r instantclient*/* /lib && \
    rm -rf instantclient-basic-linuxx64 && \
    apk add libaio && \
    apk add libaio libnsl libc6-compat && \
    cd /lib && \
    # Linking ld-linux-x86-64.so.2 to the lib/ location (Update accordingly)
    ln -s /lib64/* /lib && \
    ln -s libnsl.so.2 /usr/lib/libnsl.so.1 && \
    ln -s libc.so /usr/lib/libresolv.so.2

# Add a healthcheck (default every 30 secs)
# HEALTHCHECK CMD curl http://localhost:1880/ || exit 1

ENTRYPOINT ["npm", "start", "--cache", "/data/.npm", "--", "--userDir", "/data"]
