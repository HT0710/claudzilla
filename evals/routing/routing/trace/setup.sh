#!/usr/bin/env bash
# claudzilla as of d739a40 (answers below are pinned to it), without git history.
set -e
git -C "$REPO" archive d739a40 | tar -xf -
