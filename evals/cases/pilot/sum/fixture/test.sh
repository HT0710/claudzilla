#!/usr/bin/env bash
# Exit 0 when sum.sh adds every argument.
[ "$(bash sum.sh 1 2 3)" = 6 ] && [ "$(bash sum.sh 5)" = 5 ] && [ "$(bash sum.sh)" = 0 ]
