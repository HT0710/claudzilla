#!/usr/bin/env perl
# MessageDisplay hook: terminals print <br> raw, so show it as " · " in table rows.
# Also frames a reply that has a TL;DR: heavy line around it, half-width line after the TL;DR
# and before Picks/Next, `---` as a quarter-width dotted line. Screen only; logs keep the raw text.
# Perl, not node: runs per streamed batch and node start-up is ~40 ms.
use strict; use warnings; use utf8;
use JSON::PP;
local $/;
my $in = <STDIN> // '';
my ($mid) = $in =~ /"message_id"\s*:\s*"([\w-]+)"/;
my $dir = ($ENV{TMPDIR} || '/tmp') . '/claudzilla-rules';
my $sf = $mid && "$dir/md-$mid";
exit 0 unless $in =~ /<br|TL;DR|---|```|~~~/ || ($sf && -e $sf);
my $d = eval { decode_json($in) } or exit 0;
my $t = $d->{delta} // '';

# Per-message state across batches: o = frame open, c = closer drawn, f = in code fence, p = separator due after line end.
my %s;
if ($sf && open my $fh, '<', $sf) { %s = map { $_ => 1 } split //, <$fh> // ''; }
my $w = ($ENV{COLUMNS} // 0) > 20 ? $ENV{COLUMNS} - 4 : 76;
my ($heavy, $sep, $group) = ('━' x $w, '─' x int($w / 2), '┈' x int($w / 4));

my $o = '';
# ponytail: markers match only at a line start inside one batch; a batch split inside `**Next:**` skips that line. Carry the partial line in state if misses show up.
for (split /^/m, $t) {
  if (/^\s*(```|~~~)/) { $s{f} = !$s{f}; }
  elsif ($s{f}) { }
  elsif (/^\|/) { s{<br\s*/?>}{ · }gi; }
  elsif (/^\*\*TL;DR\*\*/ && !$s{o}) { $_ = "$heavy\n\n$_"; @s{qw(o p)} = (1, 1); }
  elsif (/^\*\*(Picks|Next):\*\*/ && $s{o} && !$s{c}) { $_ = "\n$sep\n\n$_"; $s{c} = 1; }
  elsif (/^\s*-{3,}\s*$/) { $_ = "\n$group\n\n"; }
  if ($s{p} && /\n\z/) { $_ .= "\n$sep\n\n"; $s{p} = 0; }
  $o .= $_;
}
$o .= ($o =~ /\n\z/ ? "\n" : "\n\n") . "$heavy\n" if $d->{final} && $s{o};

if ($sf) {
  my $keep = join '', grep { $s{$_} } qw(o c f p);
  if ($d->{final} || !$keep) { unlink $sf; }
  else { mkdir $dir; if (open my $fh, '>', $sf) { print $fh $keep; } }
}
exit 0 if $o eq $t;
print encode_json({ hookSpecificOutput => { hookEventName => 'MessageDisplay', displayContent => $o } }), "\n";
