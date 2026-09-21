#!/usr/bin/perl -0777
# OMC HUD -> E2 layout: identity row, rule, three full-width gradient meters, rule, activity row.
# The plugin dist is generated, so this parses its output and re-renders rather than patching it.
use strict; use warnings;

my $raw = do { local $/; <STDIN> };
(my $txt = $raw) =~ s/\e\[[0-9;]*m//g;

# no terminal width in the statusline JSON: trust COLUMNS, else ask the tty, else assume 114
my $W = 114;
{   my $cols = $ENV{COLUMNS};
    unless ($cols && $cols =~ /^\d+$/ && $cols > 20) {
        ($cols) = (`stty size < /dev/tty 2>/dev/null` // '') =~ /^\d+\s+(\d+)/;
    }
    $W = $cols - 4 if $cols && $cols =~ /^\d+$/ && $cols > 20;
}

my ($id)      = $txt =~ /\A(\w+)\n/;
# the wrapper hands us two fields the OMC text doesn't carry: the session cwd and the effort level
my ($META_CWD,$EFFORT,$SID) = split /\x1f/, ($ENV{HUD_META} // ''), 3;
# session name (/rename, or derived like "maxis-24") - the handle peers message us by.
# Not in the statusline JSON, so look it up in the per-pid session registry.
my $sname;
if ($SID) {
    my $dir = ($ENV{CLAUDE_CONFIG_DIR} // "$ENV{HOME}/.claude") . '/sessions';
    for my $file (glob "$dir/*.json") {
        open my $fh, '<', $file or next;
        my $j = do { local $/; <$fh> };
        close $fh;
        next unless index($j, $SID) >= 0;
        ($sname) = $j =~ /"name":"([^"]*)"/;
        last;
    }
}
my ($cwd)     = $txt =~ /^(\S+) \| profile:/m;
# omc-hud reports its own process cwd for non-git dirs; trust the session JSON when we have it
if (my $e = $META_CWD) { my $h = $ENV{HOME} // ''; $e =~ s/^\Q$h\E(?=\/|$)/~/ if $h; $cwd = $e; }
my ($profile) = $txt =~ /profile:(\S+)/;
# branch: OMC's is for its own process cwd, so ask git about the session cwd; blank when not a repo
my ($branch)  = $txt =~ /\| branch:(\S+)/;
my $churn = '';
my ($dirty)   = $txt =~ /\| branch:\S+ \| ([!?\d ]+?) \|/;
if ($META_CWD) {
    my $d = $META_CWD; $d =~ s/'/'\\''/g;
    $branch = `git -C '$d' branch --show-current 2>/dev/null` // ''; $branch =~ s/\s+\z//;
    $branch = undef unless length $branch;
    $dirty  = undef;
    if ($branch) {
        my @st = split /\n/, (`git -C '$d' status --porcelain 2>/dev/null` // '');
        my $m = grep { !/^\?\?/ } @st; my $u = @st - $m;
        $dirty = join ' ', ($m ? "!$m" : ()), ($u ? "?$u" : ());
        my $st = `git -C '$d' diff --shortstat 2>/dev/null` // '';
        my ($ins) = $st =~ /(\d+) insertion/; my ($del) = $st =~ /(\d+) deletion/;
        $churn = join ' ', ($ins ? "+$ins" : ()), ($del ? "-$del" : ());
    }
}
my ($model)   = $txt =~ /Model: ([^|\n]+?)\s*(?:\||$)/m;
my ($session) = $txt =~ /session:(\S+)/;
my ($skill)   = $txt =~ /skill:(\S+)/;
my ($ts)      = $txt =~ /(T:\d+ S:\d+)/;
my $thinking  = $txt =~ /^thinking\b/m || $txt =~ /\| thinking/;

my @m;
for my $spec (['ctx','ctx'], ['5h','5h'], ['wk','wk']) {
    my ($key,$label) = @$spec;
    if ($txt =~ /\Q$key\E:(?:\[[#\-]*\])?(\d+)%\*?(?:\(~?([^)]*)\))?/) {
        push @m, [$label, $1, defined $2 ? $2 : ''];
    }
}

# --- helpers ---------------------------------------------------------------
sub vis { my $s = shift; $s =~ s/\e\[[0-9;]*m//g; return length $s }
sub pad {                       # left, right -> line padded to $W
    my ($l,$r,$fill) = @_; $fill //= ' ';
    my $gap = $W - vis($l) - vis($r); $gap = 1 if $gap < 1;
    return $l . "\e[2m" . ($fill x $gap) . "\e[0m" . $r;
}
my $WID = 10;   # highlight half-width in cells
my @A = (0x0e,0x20,0x42); my @B = (0xa8,0xd6,0xff);   # blue ramp, dark -> bright
my @O = (0xff,0xaa,0x5a);                             # ...then warm over the last 30% of the track
sub ramp {
    my $x = shift;                                    # 0..1, already eased
    return $x < 0.7 ? [ map { $A[$_] + ($B[$_]-$A[$_]) * ($x/0.7) } 0..2 ]
                    : [ map { $B[$_] + ($O[$_]-$B[$_]) * (($x-0.7)/0.3) } 0..2 ];
}
# builds a whole meter row as cells, then runs the highlight across all of it -
# title, bar, figure and note alike. $head is the sweep centre, undef while resting.
sub meter_line {
    my ($label,$pct,$note,$n,$tw,@hs) = @_;
    my $f = int($pct / 100 * $n + 0.5); $f = $n if $f > $n;
    my @cell;
    push @cell, [$_, [163,150,210]] for split //, sprintf('%-3s ', $label);   # title
    for my $i (0 .. $n-1) {                                                   # bar
        my $on = $i < $f;
        push @cell, [$on ? "\x{25B0}" : "\x{25B1}",
                     $on ? [map { int($_+0.5) } @{ ramp(($n > 1 ? $i/($n-1) : 1) ** 0.85) }] : [30,42,58],
                     $on ? 0.65 : 0.30];
    }
    my $x = ($pct/100) ** 0.85; $x = 0.4 if $x < 0.4;                         # figure
    my $fc = [map { int($_+0.5) } @{ ramp($x) }];
    push @cell, [$_, $fc] for split //, sprintf(' %3d%%  ', $pct);
    push @cell, [$_, [64,71,80]] for split //, sprintf("%*s", $tw, $note);    # note
    my ($out,$prev) = ('','');
    for my $i (0 .. $#cell) {
        my ($ch,$c,$w) = @{$cell[$i]};
        $w //= 0.55;                                                          # text glows a touch less than fill
        my @c = @$c;
        my $g = 0;
        for my $h (@hs) { my $v = glow($i - $h, $WID, 1.6); $g = $v if $v > $g }
        @c = map { $c[$_] + (255 - $c[$_]) * ($g * $w) } 0..2 if $g > 0;
        @c = map { int($_ + 0.5) } @c;
        my $seq = "\e[38;2;$c[0];$c[1];$c[2]m";
        $out .= ($seq eq $prev ? '' : $seq) . $ch;
        $prev = $seq;
    }
    return $out . "\e[0m";
}
my $dim = sub { "\e[2m$_[0]\e[0m" };
# meter titles: muted lilac - clear of the teal profile and the blue->orange ramp
my $lbl = sub { "\e[38;2;163;150;210m$_[0]\e[0m" };

binmode STDOUT, ':utf8';
# per-session phase offset so concurrent sessions animate out of step
my $OFF = 0; $OFF = ($OFF * 31 + ord) % 3600 for split //, ($id // '');

my $row = 0;

my @out;

# identity: path + branch + session id, profile flush right
# cwd: per-character blue ramp, drifting one character every $DRIFT seconds
my $DRIFT = 4; my $PERIOD = 24;
sub cwd_str {
    my $text = shift;
    my @ch = split //, $text;
    my $ph = (time() + $OFF) / $DRIFT;
    my $s = "";
    for my $i (0 .. $#ch) {
        my $t = (1 - cos(6.283185307 * (($i + $ph) / $PERIOD)) ) / 2;
        my @c = (int(0x4a + (0x93-0x4a)*$t + 0.5), int(0x6b + (0xb4-0x6b)*$t + 0.5),
                 int(0x8a + (0xe0-0x8a)*$t + 0.5));
        $s .= "\e[38;2;$c[0];$c[1];$c[2]m$ch[$i]";
    }
    return $s . "\e[0m";
}
{   # narrow panes: shed the least important pieces, then trim the path itself
    my $path = $cwd // '~';
    my $p    = $profile // '';
    my @opt = ( [$branch, sub { $dim->('  ') . "\e[38;2;93;150;120m\x{2387} $_[0]\e[0m" }],
                [$dirty,  sub { $dim->(' ')  . "\e[38;2;140;120;80m$_[0]\e[0m"  }],
                [$churn,  sub { $dim->('  ') . "\e[38;2;110;140;110m$_[0]\e[0m" }] );
    my $build = sub {
        my $l = cwd_str($path);
        for my $o (@opt) { $l .= $o->[1]->($o->[0]) if defined $o->[0] }
        my $r = $p ne '' ? "\e[38;2;95;158;168m$p\e[0m" : '';
        return ($l, $r);
    };
    my $fits = sub { my ($l,$r) = $build->(); return vis($l) + vis($r) + ($r ne '' ? 2 : 0) <= $W };
    if (!$fits->()) { $p =~ s/\@.*// }                       # profile: local part only
    if (!$fits->()) { $p = '' }                              # ...then drop it
    for my $i (2,1,0) { last if $fits->(); $opt[$i][0] = undef }   # churn, dirty, branch
    if (!$fits->() && length($path) > 4) {                    # finally trim the path from the left
        my $room = $W - 1;
        $path = "\x{2026}" . substr($path, -$room + 1) if $room > 2;
    }
    my ($l,$r) = $build->();
    push @out, pad($l, $r);
}

my $tw = 0; for (@m) { $tw = length $_->[2] if length $_->[2] > $tw }
my $n  = $W - 4 - 5 - 2 - $tw;

# --- sweep -----------------------------------------------------------------
# One highlight pass every $SWEEP+$REST seconds, wall-clock driven so the timing
# holds however often the HUD renders. Each pass picks one of ten motions at
# random - the pick is a hash of the cycle number, so every render inside a
# given pass agrees on it without any stored state.
my $SWEEP = 30; my $REST = 60; my $LAG = 2;
my $CYC   = $SWEEP + $REST;
my $NOW   = time() + $OFF;
my $VAR   = ((int($NOW / $CYC) * 1103515245 + 12345) >> 7) % 10;
my $TAIL  = ($VAR == 6);        # trailing comet: asymmetric, needs a different shape

# distance from a head -> 0..1 brightness. $d is signed so the tail can drag behind.
sub glow {
    my ($d,$wid,$pw) = @_;
    if ($TAIL) {
        my ($head,$tail) = (0.5*$wid, 2.2*$wid);
        return $d > 0 ? ($d < $head ? (1 - $d/$head) ** 2.2 : 0)
                      : (-$d < $tail ? (1 + $d/$tail) ** 2.6 * 0.8 : 0);
    }
    $d = abs $d;
    return $d < $wid ? (1 - $d/$wid) ** $pw : 0;
}

# head positions on row $r (-1 = top rule, 0..2 = meters, 3 = bottom rule).
# empty while resting, or while a row is waiting its turn.
sub heads {
    my ($r) = @_;
    my $t = $NOW % $CYC;
    return () if $t >= $SWEEP;
    my $p    = $t / $SWEEP;
    my $full = $W + 2*$WID;                 # just clears both edges
    my $span = $W + 2*$WID + 12*$LAG;       # ...even for the last lagging row
    return (-$WID - $LAG + $p*$span - $r*$LAG)                    if $VAR == 0;  # diagonal comet
    return (-$WID + $p*$full)                                     if $VAR == 1;  # vertical wipe
    if ($VAR == 2) {                                                             # relay
        my $q = ($p - ($r+1)/5) * 5;
        return () if $q < 0 || $q > 1;
        return (-$WID + $q*$full);
    }
    return (-$WID + $p*$span - (8 - abs($r-1)*4))                 if $VAR == 3;  # chevron
    return (-$WID + $p*$span + sin($r*1.3 - $p*6)*10)             if $VAR == 4;  # ripple
    return (-$WID + $p*$full, $W + $WID - $p*$full)               if $VAR == 5;  # two heads
    return (-$WID + $p*($full+24) - $r*$LAG)                      if $VAR == 6;  # trailing comet
    if ($VAR == 7) {                                                             # ping-pong
        my $u = $p < 0.5 ? 2*$p : 2 - 2*$p;
        return (-$WID + $u*$full - $r*$LAG);
    }
    if ($VAR == 8) {                                                             # pulse from the fill edge
        my $edge  = ($r >= 0 && $r <= 2 && $m[$r]) ? 4 + int($m[$r][1]/100*$n + 0.5) : $W/2;
        my $reach = $p * ($W/2 + $WID);
        return ($edge - $reach, $edge + $reach);
    }
    my $th = $p * 6.283185307;                                                   # spin
    return ($W/2 + ($W/2 + $WID) * cos($th) * (1 + ($r-1)*0.28));
}

# rule comet: the same highlight running the hairline rules, in step with the bars
# (top rule rides one row ahead of ctx, lower rule one row behind wk)
my $CWID = 6;   # comet reach, as in the original: soft ^2 falloff, no hard core
my @DAY = qw(Sun Mon Tue Wed Thu Fri Sat);
my @MON = qw(Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec);
sub rule {
    my ($r,$label) = @_;
    $label //= '';
    my @hs = map { int($_ + 0.5) } heads($r);    # snap so exactly one cell is the head
    my $start = int(($W - length($label)) / 2);
    my ($out,$prev) = ('','');
    for my $i (0 .. $W-1) {
        my $g = 0;
        for my $h (@hs) { my $v = glow($i - $h, $CWID, 2); $g = $v if $v > $g }
        my $ch = "\x{2501}";
        my @b  = (38,50,64); my $w = 0.75;                  # hairline
        if (length $label && $i >= $start && $i < $start + length $label) {
            $ch = substr($label, $i - $start, 1);
            @b  = $ch eq ' ' ? (13,18,24) : (141,166,194);  # inset clock / date
            $w  = $ch eq ' ' ? 0 : 0.9;
        }
        my @c = $g > 0 ? (map { $b[$_] + ([255,236,200]->[$_] - $b[$_]) * ($g*$w) } 0..2) : @b;
        @c = map { int($_ + 0.5) } @c;
        my $seq = "\e[38;2;$c[0];$c[1];$c[2]m";
        $out .= ($seq eq $prev ? '' : $seq) . $ch;
        $prev = $seq;
    }
    return $out . "\e[0m";
}
my @lt = localtime;
push @out, rule(-1, sprintf(' %02d:%02d ', @lt[2,1]));

for my $r (@m) {
    my ($label,$pct,$note) = @$r;
    push @out, meter_line($label, $pct, $note, $n, $tw, heads($row++));
}

push @out, rule(3, sprintf(' %s %02d %s ', $DAY[$lt[6]], $lt[3], $MON[$lt[4]]));

# activity: skill, thinking, tool/skill counters; uptime flush right
{   # same treatment as the identity row, measured on the rendered strings
    my $mo = defined $model ? $model : undef;
    $mo .= "\e[38;2;127;182;217m\e[2m  $EFFORT\e[0m" if defined $mo && $EFFORT;
    my @L = ( [$mo,       sub { "\e[38;2;127;182;217m$_[0]\e[0m" }],
              [$skill,    sub { "\e[38;2;147;180;224m\x{2691} $_[0]\e[0m" }],
              [$thinking, sub { "\e[38;2;169;143;217m\x{25C7} thinking\e[0m" }],
              [$ts,       sub { $dim->($_[0]) }] );
    my @R = ( [$sname,    sub { "\e[38;5;109m$_[0]\e[0m" }],
              [$id,       sub { "\e[38;2;79;92;104m$_[0]\e[0m" }],
              [$session,  sub { "\e[38;2;69;97;134mup $_[0]\e[0m" }] );
    my $build = sub {
        my $j = $dim->('  ');
        return (join($j, map { $_->[1]->($_->[0]) } grep { $_->[0] } @L),
                join($j, map { $_->[1]->($_->[0]) } grep { $_->[0] } @R));
    };
    my $fits = sub { my ($l,$r) = $build->(); return vis($l) + vis($r) + ($r ne '' ? 2 : 0) <= $W };
    for my $i (3,2,1) { last if $fits->(); $L[$i][0] = undef }   # T:S, thinking, skill
    for my $i (1,0) { last if $fits->(); $R[$i][0] = undef }      # session id, then name
    $L[0][0] = undef unless $fits->();                            # model, last resort
    my ($ls,$rs) = $build->();
    push @out, pad($ls, $rs);
}

print join("\n", @out), "\n";
