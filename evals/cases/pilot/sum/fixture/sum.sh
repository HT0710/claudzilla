#!/usr/bin/env bash
# Prints the sum of its integer arguments.
total=0
for ((i = 1; i < $#; i++)); do
  total=$((total + ${!i}))
done
echo "$total"
