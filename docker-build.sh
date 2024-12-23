#!/bin/bash

TAG_NANE="$(git rev-parse --short=12 HEAD)"
echo "TAG_NANE=$TAG_NANE"

docker build -t bosagora/acc-phone-link-validator:"$TAG_NANE" -f Dockerfile .
