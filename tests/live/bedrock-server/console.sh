#!/bin/sh
# SPDX-License-Identifier: CC0-1.0
# Types one line into the console of the Bedrock server that docker-compose.yml, beside this file, starts. For
# the live tests, from the repo's root:
#   BEDROCK_TEST_CONSOLE=tests/live/bedrock-server/console.sh
# (The tests split that variable on spaces, so it must be a path with none; this relative one has none.)
#
# The image has its own send-command, which looks for the server's program among the container's processes.
# Under emulation (Docker Desktop on an Apple silicon Mac) every process in the container is the emulator, so
# it never finds it. This finds the server by its command line instead, which is the same with or without
# emulation, and writes the line to its input. BEDROCK_TEST_CONTAINER names another container.
exec docker exec "${BEDROCK_TEST_CONTAINER:-bedrock-test}" sh -c '
for p in /proc/[0-9]*; do
  cmd=$(tr "\0" " " < "$p/cmdline" 2>/dev/null)
  case "$cmd" in ./bedrock_server-*) echo "$*" > "$p/fd/0"; exit 0 ;; esac
done
echo "unable to find the bedrock server process"; exit 2' _ "$@"
