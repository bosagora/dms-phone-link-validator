#!/bin/bash

TAG_NANE="$(git rev-parse --abbrev-ref HEAD)-$(git rev-parse --short=6 HEAD)"
echo "TAG_NANE=$TAG_NANE"

docker buildx build --platform=linux/amd64,linux/arm64 -t bosagora/acc-phone-link-validator:"$TAG_NANE" -f Dockerfile --push .
docker buildx build --platform=linux/amd64,linux/arm64 -t bosagora/acc-phone-link-validator:latest -f Dockerfile --push .

