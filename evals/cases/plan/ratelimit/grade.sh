#!/usr/bin/env bash
# Pass: the plan hits at least 4 of 5 points a sound design needs (reuse, status, header, client identity, bucket memory).
# Keyword proxy for plan quality; judge.mjs adds a score against a reference plan.
C="$(cd "$(dirname "$0")" && pwd)"
text=$(node "$C/../../../tx.mjs" text "$TRANSCRIPT")
n=0
for re in 'TokenBucket|limits\.mjs' '429' 'Retry-After' 'trustProxy|X-Forwarded-For' 'evict|LRU|TTL|prune|sweep|clean ?up|stale|unbounded|memory'; do
  printf '%s\n' "$text" | grep -qiE "$re" && n=$((n + 1))
done
[ "$n" -ge 4 ]
