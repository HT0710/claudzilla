#!/bin/sh
# Drop "by @author in <PR link>" from generated change lines; New Contributors lines keep theirs.
#   gh api repos/OWNER/REPO/releases/generate-notes -f tag_name=v1.2.3 -q .body | sh .github/release-notes.sh
sed -E 's/ by @[^ ]+ in https:[^ ]+\/pull\/[0-9]+$//'
