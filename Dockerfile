ARG NODE_VERSION=14
ARG OS=ubi8

#### Stage BUILD ########################################################################################################
FROM registry.access.redhat.com/${OS} as build

RUN  dnf module install --nodocs -y nodejs:${OS} python39 --setopt=install_weak_deps=0 --disableplugin=subscription-manager \
    && dnf install --nodocs -y make gcc gcc-c++  --setopt=install_weak_deps=0 --disableplugin=subscription-manager \
    && dnf clean all --disableplugin=subscription-manager
    
RUN mkdir -p /opt/app-root/src/node-red
WORKDIR /opt/app-root/src/node-red
COPY package.json .
COPY flows.json .
RUN npm install --no-audit --no-update-notifier --no-fund --production
COPY . .

### Stage RELEASE #####################################################################################################
FROM registry.access.redhat.com/${OS}/nodejs-${NODE_VERSION}
ARG BUILD_DATE
ARG BUILD_VERSION
ARG BUILD_REF
ARG NODE_RED_VERSION
ARG ARCH
ARG TAG_SUFFIX=default

LABEL org.label-schema.build-date=${BUILD_DATE} \
    org.label-schema.docker.dockerfile="Dockerfile.ubi8" \
    org.label-schema.license="Apache-2.0" \
    org.label-schema.name="Node-RED" \
    org.label-schema.version=${BUILD_VERSION} \
    org.label-schema.description="Low-code programming for event-driven applications." \
    org.label-schema.url="https://nodered.org" \
    org.label-schema.vcs-ref=${BUILD_REF} \
    org.label-schema.vcs-type="Git" \
    org.label-schema.vcs-url="https://git.puma.corp.telstra.com/virtual-operator/virtual-operator-core-docker"

COPY --from=build /opt/app-root/src/node-red /opt/app-root/src/node-red

WORKDIR /opt/app-root/src/node-red

# Add the VO custom nodes
RUN ls /opt/app-root/src/node-red
RUN mkdir -p /opt/app-root/src/node-red/node_modules/@node-red/nodes/core/vo
COPY /nodes/ /opt/app-root/src/node-red/node_modules/@node-red/nodes/core/vo
RUN ls /opt/app-root/src/node-red/node_modules/@node-red/nodes/core/vo

# Env variables
ENV NODE_ENV=production
ENV NODE_RED_VERSION=$NODE_RED_VERSION \
    NODE_PATH=/opt/app-root/src/node-red/node_modules:/data/node_modules \
    PATH=/opt/app-root/src/node-red/node_modules/.bin:${PATH} \
    FLOWS=flows.json

# ENV NODE_RED_ENABLE_SAFE_MODE=true    # Uncomment to enable safe start mode (flows not running)
# ENV NODE_RED_ENABLE_PROJECTS=true     # Uncomment to enable projects option

# Expose the listening port of node-red
EXPOSE 1880

ENTRYPOINT ["npm", "start", "--cache", "/data/.npm", "--", "--userDir", "/data"]
