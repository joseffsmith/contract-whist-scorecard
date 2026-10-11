#!/bin/sh
# Run by the nginx image's entrypoint before nginx starts. Keeps the
# password sign-in service running in the background (restarts on crash).
(while true; do
  node /srv/auth/auth.mjs
  echo "auth service exited; restarting in 2s" >&2
  sleep 2
done) &
