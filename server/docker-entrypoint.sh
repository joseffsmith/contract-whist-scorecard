#!/bin/sh
# nginx in the background, then node as PID 1 so it receives SIGTERM.
set -e
nginx
exec node /srv/whist/index.mjs
