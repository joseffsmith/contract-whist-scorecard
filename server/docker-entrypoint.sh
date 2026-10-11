#!/bin/sh
# nginx in the background, then node as PID 1 so it receives SIGTERM.
set -e
nginx
# The server sits behind nginx (nginx.conf proxies to 127.0.0.1:3001).
# Pin it there: platforms like Coolify inject PORT/HOST for the public port
# (80, which nginx owns), and the server would otherwise try to bind it.
export PORT=3001 HOST=127.0.0.1
exec node --disable-warning=ExperimentalWarning /srv/whist/index.mjs
