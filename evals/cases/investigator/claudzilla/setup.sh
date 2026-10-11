#!/usr/bin/env bash
# claudzilla as of a61724f (answers below are pinned to it), without git history.
set -e
git -C "$REPO" archive a61724f | tar -xf -
