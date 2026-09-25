#!/usr/bin/env perl
# MessageDisplay hook: terminals print <br> raw, so show it as " · " in table rows.
# Perl, not node: runs per streamed batch and node start-up is ~40 ms.
use strict; use warnings; use utf8;
use JSON::PP;
local $/;
my $in = <STDIN> // '';
exit 0 unless $in =~ /<br/i;
my $d = eval { decode_json($in) } or exit 0;
my $t = $d->{delta} // '';
my $o = join '', map { /^\|/ ? s{<br\s*/?>}{ · }gir : $_ } split /^/m, $t;
exit 0 if $o eq $t;
print encode_json({ hookSpecificOutput => { hookEventName => 'MessageDisplay', displayContent => $o } }), "\n";
