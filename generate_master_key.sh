#!/usr/bin/env bash
# Generate a base64-encoded 32-byte master key
head -c 32 /dev/urandom | base64
