#!/bin/sh

set -x

# Retrieve test client ID
client_id=$(cozy-stack instances client-oauth \
  cozy.tools:8080 \
  http://cozy.tools/ \
  test \
  github.com/cozy-labs/cozy-desktop)

# Retrieve test token
token=$(cozy-stack instances token-oauth \
  cozy.tools:8080 \
  "$client_id" \
  io.cozy.files io.cozy.settings)

# Generate test env file
cat >${ENVFILE:-$(dirname $0)/../.env.test} <<EOF
COZY_CLIENT_ID=$client_id
COZY_STACK_TOKEN=$token
NODE_ENV=test
EOF
