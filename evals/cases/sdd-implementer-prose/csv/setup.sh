#!/usr/bin/env bash
# Same task, fixture and grader as sdd-implementer-code/csv; only the brief differs (rules in prose, no code).
set -e
CODE="$CASE_DIR/../../sdd-implementer-code/csv"
cp -R "$CODE/fixture/." .
CASE_DIR="$CODE" bash "$CODE/setup.sh"
cp "$CASE_DIR/brief.md" .sdd/brief.md
