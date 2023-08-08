---
description: Redwood's Dockerfile
---

# Docker

If you're not familiar with Docker, we recommend spending some time going through Docker's [getting started](https://docs.docker.com/get-started/) documentation.

## Set up

To get started, run the setup command:

```
yarn rw setup docker
```

You should have a `Dockerfile` and a `docker-compose.yml` file for local development which you can start with:

```
docker compose up
```

<!-- The first time you do this, you'll have to use the console to go in and migrate the database—just like you would with a Redwood app on your machine. -->

## Deploying

Docker unlocks many deploy providers.
But equally as important, it improves upon some familiar ones.

### AWS

With Docker, you can deploy straight to AWS, though it involves some config and some expertise.

### Coherence

[Coherence](https://www.withcoherence.com/) has first-class Docker support and handles migrations the best of any deploy provider we've seen.

### Flightcontrol

[Flightcontrol](https://www.flightcontrol.dev/) supports Docker.

### Fly

Dockerfiles and [Fly](https://fly.io/) are a match well made.

It shouldn't really come up, but know that Fly does things a bit differently.
You send them Dockerfiles, but they don't use Docker.

### Render

[Render supports Docker](https://render.com/docs/docker), and even uses the new BuildKit.
But Render [doesn't support targeting stages](https://community.render.com/t/specify-a-target-build-stage-for-multi-stage-dockerfile/2219) in a Dockerfile with mutli stage builds.
So you have to split the Dockerfile up in two: `Dockerfile.api` and `Dockerfile.web`.
(You may prefer this anyway.)

The issue is, we recommend serving the web side on a CDN.
That would use Render's static runtime, but the static runtime doesn't support Docker.
So you really end up with one Dockerfile for the api side.
It may not be bad, but it's something to note.

## The issue of migrations

Migrations are a bit tricky.

Some deploy providers have a first-class way of dealing with them; others don't.

For those that don't, we think that the most robust way is to just handle them yourself by connecting the database when necessary.
**This requires care**.

Of the dpeloy providers listed above that have a first-class way of handling migrations...

- Coherence
- Fly

[Render is currently working on a separate life cycle script](https://community.render.com/t/release-command-for-db-migrations/247/17).
But for the time being, they do have [other recommendations](https://community.render.com/t/release-command-for-db-migrations/247/10).

## The Dockerfile in detail

The documentation here goes through and explains every line of Redwood's Dockerfile.
If you'd like to see the whole Dockerfile, you can find it here: [todo].
Or by setting it up in your project: `yarn rw setup docker`.

### The `base` stage

The `base` stage installs dependencies.
It's used as the base image for the build stages and the `console` stage.

```Dockerfile
FROM node:18-bookworm-slim as base
```

We use a Node.js 18 image as the base image because that's what Redwood targets.
"bookworm" is the codename for the current stable distribution of Debian (version 12).
We think it's important to pin the version of the OS just like we pin the version of Node.js.
Lastly, the "slim" variant of the `node:18-bookworm` image only includes what Node.js needs which reduces the image's size while making it more secure.

```Dockerfile
RUN apt-get update && apt-get install -y \
    openssl \
    && rm -rf /var/lib/apt/lists/*
```

The `node:18-bookworm-slim` image doesn't have [OpenSSL](https://www.openssl.org/), which [seems to be a bug](https://github.com/nodejs/docker-node/issues/1919).
(It was included in the bullseye image, the codename for Debian 11.)
When running on Linux distributions, [Prisma needs OpenSSL](https://www.prisma.io/docs/reference/system-requirements#linux-runtime-dependencies).
After installing it, we clean up the apt cache, adhering to [Docker best practices](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/#apt-get).

It's recommended to combine `apt-get update` and `apt-get install -y` in the same `RUN` statement for cache busting. See https://docs.docker.com/develop/develop-images/dockerfile_best-practices/#apt-get.

```Dockerfile
USER node
```

This and subsequent `chown` options in `COPY` instructions are for security.
Services that can run without priveleges should.
The Node.js image includes a user, created with an explicit `uid` and `gid`, node; we reuse it.
See https://docs.docker.com/develop/develop-images/dockerfile_best-practices/#user.

```Dockerfile
WORKDIR /home/node/app

COPY --chown=node:node .yarn/releases .yarn/releases
COPY --chown=node:node .yarnrc.yml .yarnrc.yml
COPY --chown=node:node package.json package.json
COPY --chown=node:node api/package.json api/package.json
COPY --chown=node:node web/package.json web/package.json
COPY --chown=node:node yarn.lock yarn.lock
```

Here we copy the minimum set of files that the `yarn install` step needs.
The order isn't completely arbitrary—it tries to maximize [Docker's layer caching](https://docs.docker.com/build/cache/).
We expect `yarn.lock` to change more than the package.json files, the package.json files to change more than `.yarnrc.yml` , and `.yarnrc.yml` to change more than the binary.
That said, it's hard to argue that these files couldn't be arranged differently, or combined into COPY instructions.
The important thing is that they're all here, before the `yarn install` step:

```Dockerfile
RUN --mount=type=cache,target=/home/node/.yarn/berry/cache,uid=1000 \
    --mount=type=cache,target=/home/node/.cache,uid=1000 \
    CI=1 yarn install
```

The `yarn install` step.
This step installs all your project's dependencies—production and dev.
Since we use multi-stage builds, your production images won't pay for the dev dependencies installed in this step.
The build stages need the dev dependnecies.

This step is a bit more involved than the others.
It uses a [cache mount](https://docs.docker.com/build/cache/#use-your-package-manager-wisely).
Yarn operates in three steps: resolution, fetch, and link.
The cache for the fetch step is the heaviest.
We could disable it all together, but by using a cache mount, we can get the benefits without paying.
We set it to the default directory here, but you can change its location in `.yarnrc.yml`.
If you've done so you'll have to change it here too.

The last thing to note is that we designate the node user.
[The node user's `uid` is `1000`](https://github.com/nodejs/docker-node/blob/57d57436d1cb175e5f7c8d501df5893556c886c2/18/bookworm-slim/Dockerfile#L3-L4).

One more thing to note: without setting `CI=1`, depending on the deploy provider, yarn may think it's in a TTY, making the logs difficult to read. With this set, yarn adapts accordingly.
Enabling CI enables `--immutable --inline-builds`, both of which are highly recommended.

- https://yarnpkg.com/configuration/yarnrc#enableInlineBuilds
- https://yarnpkg.com/configuration/yarnrc#enableProgressBars
- https://yarnpkg.com/configuration/yarnrc#enableTelemetry

```Dockerfile
COPY --chown=node:node redwood.toml .
COPY --chown=node:node graphql.config.js .
```

We'll need these config files for the build and production stages.
The `redwood.toml` file is Redwood's de-facto config file.
Both the build and serve stages pull from it to enable and configure functionality.

### The `api_build` stage

The `api_build` builds the api side.

```Dockerfile
FROM base as api_build

COPY --chown=node:node api api
RUN yarn redwood build api
```

After the work we did in the base stage, building the api side amounts to copying in the api directory and running yarn redwood build api.

### The `api_serve` stage

The `api_serve` stage serves your GraphQL api and functions.

```Dockerfile
FROM node:18-bookworm-slim as api_serve

RUN apt-get update && apt-get install -y \
    openssl \
    && rm -rf /var/lib/apt/lists/*
```

We don't start from the base stage, but begin anew with the `node:18-bookworm-slim` image.
Since this is a production stage, it's important for it to be as small as possible.
Docker's [multi-stage builds](https://docs.docker.com/build/building/multi-stage/) enables this.

```Dockerfile
USER node
WORKDIR /home/node/app

COPY --chown=node:node .yarn/plugins .yarn/plugins
COPY --chown=node:node .yarn/releases .yarn/releases
COPY --chown=node:node .yarnrc.yml .yarnrc.yml
COPY --chown=node:node api/package.json .
COPY --chown=node:node yarn.lock yarn.lock
```

The thing that's easy to miss here is that we're copying the `api/package.json` file into the base directory, so that it's just `package.json` in the image.
This is for the production `yarn install` in the next step.

Like other `COPY` instructions, ordering these files with cares enables layering caching.

```Dockerfile
RUN --mount=type=cache,target=/home/node/.yarn/berry/cache,uid=1000 \
    --mount=type=cache,target=/home/node/.cache,uid=1000 \
    CI=1 yarn workspaces focus api --production
```

This is a critical step for image size.
We don't use the regular `yarn install` command.
Using the [official workspaces plugin](https://github.com/yarnpkg/berry/tree/master/packages/plugin-workspace-tools)—which will be included by default in yarn v4—we "focus" on the api workspace, only installing its production dependencies.

The cache mount will be populated at this point from the install in the `base` stage, so the fetch step in the yarn install should fly by.

```Dockerfile
COPY --chown=node:node redwood.toml .
COPY --chown=node:node graphql.config.js .

COPY --chown=node:node --from=api_build /home/node/app/api/dist /home/node/app/api/dist
COPY --chown=node:node --from=api_build /home/node/app/api/db /home/node/app/api/db
COPY --chown=node:node --from=api_build /home/node/app/node_modules/.prisma /home/node/app/node_modules/.prisma
```

Here we take advantage of our Dockerfile's multi-stage builds by copying from the `api_build` stage.
All the building has been done for us—now we can just grab the artifacts without having to lug aronud the dev dependencies.

There's one more thing that was built—the prisma client in `node_modules/.prisma`.
We need to grab it too.

```Dockerfile
CMD [ "node_modules/.bin/rw-server", "api" ]
```

Lastly, the default command is to start the api server using the bin from the `@redwoodjs/api-server` package.
You can override this command.

Note that the Redwood CLI isn't available anymore.
To access the server bin, we have to find it's path.
Though this is somewhat discouratged in modern yarn, since we're using the `node_modules` linker, it's in `node_modules/.bin`.

### The `web_build` stage

This `web_build` builds the web side.

```Dockerfile
FROM base as web_build

COPY --chown=node:node web web
RUN node_modules/.bin/redwood build web --no-prerender
```

After the work we did in the base stage, building the web side amounts to copying in the web directory and running `yarn redwood build web`.

This stage is a bit of a simplification.
It foregoes Redwood's prerendering (SSG) capability.
Prerendering is a little trickier; see [The `web_prerender_build` stage](#the-web_prerender_build-stage).

### The `web_prerender_build` stage

The `web_prerender_build` stage builds the web side with prerender.

```Dockerfile
FROM api_build as web_build_with_prerender

COPY --chown=node:node web web
RUN yarn redwood build web
```

Building the web side with prerender enabled poses a challenge.
Prerender needs api side around to get data for your Cells and route hooks.
The key line here is the first one—this stage uses the `api_build` stage as its base image.

### The `web_serve` stage

```Dockerfile
FROM node:18-bookworm-slim as web_serve

USER node
WORKDIR /home/node/app

COPY --chown=node:node .yarn/plugins .yarn/plugins
COPY --chown=node:node .yarn/releases .yarn/releases
COPY --chown=node:node .yarnrc.yml .
COPY --chown=node:node web/package.json .
COPY --chown=node:node yarn.lock .

RUN --mount=type=cache,target=/home/node/.yarn/berry/cache,uid=1000 \
    --mount=type=cache,target=/home/node/.cache,uid=1000 \
    CI=1 yarn workspaces focus web --production

COPY --chown=node:node redwood.toml .
COPY --chown=node:node graphql.config.js .

COPY --chown=node:node --from=web_build /home/node/app/web/dist /home/node/app/web/dist

ENV NODE_ENV=production \
    API_HOST="https://restless-fire-2367.fly.dev"

CMD "node_modules/.bin/rw-server" "web" "--apiHost" "$API_HOST"
```

Note that we're using the same binary to serve the web side as we did to serve the api side.
This isn't exactly ideal since we're lugigng some weight around we don't need to.
This is something we're actively working on.

### The `console` stage

The `console` stage is an optional stage for debugging.

```Dockerfile
FROM base as console

# To add more packages:
#
# ```
# USER root
#
# RUN apt-get update && apt-get install -y \
#     curl
#
# USER node
# ```

COPY --chown=node:node api api
COPY --chown=node:node web web
COPY --chown=node:node scripts scripts
```

The console stage completes the base stage by copying in the rest of your Redwood app.
But then it pretty much leaves you to your own devices.
The intended way to use it is to create an ephemeral container by starting a shell like `/bin/bash` in the image built by targeting this stage:

```bash
# Build the console image:
docker build . -t console --target console
# Start an ephemeral container from it:
docker run --rm -it console /bin/bash
```

As the comment says, feel free to add more packages.
We intentionally kept them to a minimum in the base stage, but you shouldn't worry about the size of the image here.
