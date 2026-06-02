#!/bin/sh
set -e

if [ -z "$API_UPSTREAM" ]; then
  echo "API_UPSTREAM must be set (e.g. https://your-api.run.app)" >&2
  exit 1
fi

# substitute the API_UPSTREAM environment variable into the nginx configuration
envsubst '${API_UPSTREAM}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;' # run nginx in the foreground
