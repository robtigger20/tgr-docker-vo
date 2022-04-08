* FROM image-registry.openshift-image-registry.svc:5000/openshift/nodejs

# First stage builds the application
FROM ubi8/nodejs-16 as builder

# Add application sources
ADD app-src $HOME

# Install the dependencies
RUN npm install

# Second stage copies the application to the minimal image
FROM ubi8/nodejs-16-minimal

# Copy the application source and build artifacts from the builder image to this one
COPY --from=builder $HOME $HOME

# Run script uses standard ways to run the application
CMD npm run -d start
