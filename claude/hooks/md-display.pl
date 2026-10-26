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
exit 0 unless $in =~ /<br|TL;DR|---|```|~~~/i || ($sf && -e $sf);
my $d = eval { decode_json($in) } or exit 0;
my $t = $d->{delta} // '';

# Per-message state across batches: o = frame open, c = closer drawn, f/t = in ``` / ~~~ fence, p = separator due after line end.
my %s;
if ($sf && open my $fh, '<', $sf) { %s = map { $_ => 1 } split //, <$fh> // ''; }
# COLUMNS is the whole terminal; folio writes the chat's width, narrower while the panel docks.
my $cols = $ENV{COLUMNS} // 0;
my ($sid) = ($d->{session_id} // '') =~ /^([\w-]+)$/;
if ($sid && open my $ch, '<', "$dir/cols-$sid") { my ($c) = (<$ch> // '') =~ /^(\d+)/; $cols = $c if $c; }
my $w = $cols > 20 ? $cols - 4 : 76;
my ($heavy, $sep, $group) = ('━' x $w, '─' x int($w / 2), '┈' x int($w / 4));

my $o = '';
my ($opened, $closed, $groups) = (0, 0, 0);
# ponytail: each batch is read as starting a line, so a batch split mid-line can miss a marker (`**Next:**`) or misread `---`/fences;
# fence length is ignored and a setext `---` underline shows as a group line. Carry the partial line in state if misses show up.
for (split /^/m, $t) {
  if (/^\s*(```|~~~)/) { my $k = $1 eq '```' ? 'f' : 't'; $s{$k} = !$s{$k} if $s{$k} || !($s{f} || $s{t}); }
  elsif ($s{f} || $s{t}) { }
  elsif (/^\|/) { s{<br\s*/?>}{ · }gi; }
  elsif (/^\*\*TL;DR\*\*/ && $sf && !$s{o}) { $_ = "$heavy\n\n$_"; @s{qw(o p)} = (1, 1); $opened = 1; }
  elsif (/^\*\*(Picks|Next):\*\*/ && $s{o} && !$s{c}) { $_ = "\n$sep\n\n$_"; $s{c} = 1; $closed = 1; }
  elsif (/^\s*-{3,}\s*$/) { $_ = "\n$group\n\n"; $groups++; }
  if ($s{p} && /\n\z/) { $_ .= "\n$sep\n\n"; $s{p} = 0; }
  $o .= $_;
}
$o .= ($o =~ /\n\z/ ? "\n" : "\n\n") . "$heavy\n" if $d->{final} && $s{o};

if ($sf) {
  my $keep = join '', grep { $s{$_} } qw(o c f t p);
  if ($d->{final} || !$keep) { unlink $sf; }
  else { mkdir $dir; if (open my $fh, '>', $sf) { print $fh $keep; } }
}
my $ended = $d->{final} && $s{o};
if ($opened || $closed || $ended) {
  eval {
    require(($0 =~ m{^(.*)/} ? $1 : '.') . '/trace.pl');
    trace_write({ session => $d->{session_id}, part => 'md-display', event => 'display.frame',
                  data => { message => $mid, opened => $opened, closed => $closed, final => $d->{final} ? 1 : 0, groups => $groups } });
  };
}
exit 0 if $o eq $t;
print encode_json({ hookSpecificOutput => { hookEventName => 'MessageDisplay', displayContent => $o } }), "\n";
