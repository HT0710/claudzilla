Using only the code in this folder: a user turned on the experimental Agent routing feature, and now their third search in a turn gets blocked. Trace that path hop by hop and answer each with `path:line`:

1. The settings entry that runs the blocking hook before a tool call.
2. The line in that hook that decides whether the feature is on.
3. The line that reads the user's config file to make that decision.
4. The line that denies the tool call.
