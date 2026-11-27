#!/usr/bin/perl
# statusline JSON -> E2 layout: identity row, rule, meters in two columns (ctx over cch | 5h over wk), rule, activity row.
# hud.layout in claudzilla.json: "compact" drops the rules and puts all meters on one row when the width allows;
# "minimal" draws one row: place and model left, meters right.
use strict; use warnings;
use Fcntl qw(:flock O_RDWR O_WRONLY O_CREAT O_TRUNC);
# stdin, files and `git` output are UTF-8 bytes: dec() decodes them, so non-ASCII paths aren't encoded twice.
# Invalid bytes (a branch name git allows) become U+FFFD, quietly: a statusline has no stderr reader.
binmode STDOUT, ':utf8';
no warnings 'utf8';
my $T = time; my @lt = localtime $T;
# C0/C1 control chars in text the filter reads itself (session name, branch) would reach the terminal.
sub clean { my $s = shift; $s =~ tr/\x00-\x1f\x7f-\x9f/ / if defined $s; return $s }

sub dec {
    my $c = my $s = shift;
    return $c if utf8::decode($c);
    $s =~ s/([\x00-\x7f]|[\xc2-\xdf][\x80-\xbf]|\xe0[\xa0-\xbf][\x80-\xbf]|[\xe1-\xec\xee\xef][\x80-\xbf]{2}|\xed[\x80-\x9f][\x80-\xbf]|\xf0[\x90-\xbf][\x80-\xbf]{2}|[\xf1-\xf3][\x80-\xbf]{3}|\xf4[\x80-\x8f][\x80-\xbf]{2})|./defined $1 ? $1 : "\xEF\xBF\xBD"/gse;
    utf8::decode($s);
    return $s;
}
sub read_kv {
    my $raw = do { local $/; <STDIN> } // '';
    $raw =~ s/\e\[[0-9;]*m//g;
    return { map { /^([^\t]+)\t(.*)$/ ? ($1, dec($2)) : () } split /\n/, $raw };
}
# git with stderr closed and no shell; output is bytes
sub git_out {
    my $pid = open(my $p, '-|') // return '';
    unless ($pid) { open STDERR, '>', '/dev/null'; exec 'git', @_ or exit 127 }
    my $o = do { local $/; <$p> } // '';
    close $p;
    return $o;
}

# --- gather: statusline JSON on stdin + transcript + config -> cleaned key/value hash ---
# Recursive-descent JSON on $_: objects -> hashref, arrays -> arrayref, true/false -> \1/\0, null -> undef.
# Any parse error or trailing garbage gives undef; dig accepts it.
sub json_parse {
    local $_ = shift // ""; pos($_) = 0;
    no warnings 'recursion';
    my $v = eval { my $r = jval(); /\G[ \t\n\r]*\z/gc or die; $r };
    return $@ ? undef : $v;
}
sub jval {
    /\G[ \t\n\r]*/gc;
    if (/\G\{/gc) {
        my %h; /\G[ \t\n\r]*/gc;
        return \%h if /\G\}/gc;
        while (1) {
            /\G[ \t\n\r]*"/gc or die; my $k = jstr();
            /\G[ \t\n\r]*:/gc or die;
            $h{$k} = jval(); /\G[ \t\n\r]*/gc;
            next if /\G,/gc;
            /\G\}/gc or die; return \%h;
        }
    }
    if (/\G\[/gc) {
        my @a; /\G[ \t\n\r]*/gc;
        return \@a if /\G\]/gc;
        while (1) {
            push @a, jval(); /\G[ \t\n\r]*/gc;
            next if /\G,/gc;
            /\G\]/gc or die; return \@a;
        }
    }
    return jstr() if /\G"/gc;
    return $1 + 0 if /\G(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?)/gc;
    return \1 if /\Gtrue/gc;
    return \0 if /\Gfalse/gc;
    return undef if /\Gnull/gc;
    die;
}
sub jstr {
    my $s = '';
    my %esc = ('"' => '"', '\\' => '\\', '/' => '/', b => "\b", f => "\f", n => "\n", r => "\r", t => "\t");
    while (1) {
        if (/\G([^"\\\x00-\x1f]+)/gc) { $s .= $1 }
        elsif (/\G\\u([0-9a-fA-F]{4})/gc) {
            my $c = hex $1;
            if ($c >= 0xD800 && $c <= 0xDBFF && /\G\\u([dD][c-fC-F][0-9a-fA-F]{2})/gc) { $c = 0x10000 + (($c - 0xD800) << 10) + (hex($1) - 0xDC00) }
            elsif ($c >= 0xD800 && $c <= 0xDFFF) { $c = 0xFFFD }
            $s .= chr $c;
        }
        elsif (/\G\\(["\\\/bfnrt])/gc) { $s .= $esc{$1} }
        elsif (/\G"/gc) { return $s }
        else { die }
    }
}
# value at a key path; undef when a step is not a hash or the key is missing
sub dig { my $v = shift; for my $k (@_) { return undef unless ref $v eq 'HASH'; $v = $v->{$k} } return $v }
# JS Math.round: half goes up, also for negatives
sub round_half_up {
    my $x = shift;
    my $f = int $x; $f-- if $x < $f;
    return $f + ($x - $f >= 0.5 ? 1 : 0);
}
# a finite JSON number, not a numeric-looking string: bitwise xor of two strings is a string, of numbers 0
# (breaks under `use v5.28`+ or feature 'bitwise', where ^ is always numeric)
sub is_num { my $v = shift; return 0 if !defined $v || ref $v; return 0 if $v =~ /[^\x00-\xff]/; no warnings; return ($v ^ $v) eq '0' && abs($v) < 9**9**9 }
sub truthy { my $v = shift; return 0 unless defined $v; return ${$v} ? 1 : 0 if ref $v eq 'SCALAR'; return 1 if ref $v; return is_num($v) ? $v != 0 : length($v) > 0 }
# JS String(): only for values that go on screen
sub str { my $v = shift; return undef unless defined $v; return ${$v} ? 'true' : 'false' if ref $v eq 'SCALAR'; return join ',', map { str($_) // '' } @$v if ref $v eq 'ARRAY'; return '[object Object]' if ref $v; return "$v" }
sub pct { my $v = shift; return undef unless is_num($v); my $r = round_half_up($v); return $r < 0 ? 0 : $r > 100 ? 100 : $r }
sub count { my $v = shift; return is_num($v) && $v > 0 ? $v : 0 }
# ISO 8601 -> epoch seconds (days-from-civil, no Time::Local); fractions dropped, no offset means UTC
sub iso_epoch {
    my ($y, $m, $d, $H, $M, $S, $z) = ($_[0] // '') =~ /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d)(?::(\d\d))?(?:\.\d+)?)?(Z|[+-]\d\d:\d\d)?\z/ or return undef;
    return undef if $m < 1 || $m > 12 || $d < 1 || $d > 31 || ($H // 0) > 23 || ($M // 0) > 59 || ($S // 0) > 59;
    $y -= 1 if $m <= 2;
    my $era = int($y / 400); my $yoe = $y - $era * 400;
    my $doy = int((153 * ($m + ($m > 2 ? -3 : 9)) + 2) / 5) + $d - 1;
    my $days = $era * 146097 + $yoe * 365 + int($yoe / 4) - int($yoe / 100) + $doy - 719468;
    my $t = $days * 86400 + ($H // 0) * 3600 + ($M // 0) * 60 + ($S // 0);
    if ($z && $z ne 'Z') { my ($sg, $zh, $zm) = $z =~ /^([+-])(\d\d):(\d\d)/; $t -= ($sg eq '-' ? -1 : 1) * ($zh * 3600 + $zm * 60) }
    return $t;
}
# host of a base URL (brackets kept for IPv6), undef when empty
sub api_host {
    my ($u) = @_;
    $u =~ s{^[a-z][a-z0-9+.-]*://}{}i; $u =~ s{[/?#].*}{}s; $u =~ s/^.*@//s; $u =~ s/:\d*\z//;
    return length $u ? $u : undef;
}
# "2h5m" / "3d4h" until a reset given as seconds, milliseconds, a numeric string or a date; undef when past
sub reset_in {
    my $v = shift; my $sec;
    if (is_num($v)) { $sec = abs($v) < 1e12 ? $v : $v / 1000 }
    elsif (defined $v && !ref $v && $v =~ /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*\z/) { my $n = $1 + 0; $sec = abs($n) < 1e12 ? $n : $n / 1000 }
    else { $sec = iso_epoch($v) }
    return undef unless defined $sec;
    my $left = int(($sec - $T) / 60); $left-- if ($sec - $T) / 60 < $left;
    return undef unless $left > 0;
    my $h = int($left / 60);
    return $h >= 24 ? int($h / 24) . 'd' . $h % 24 . 'h' : $h . 'h' . $left % 60 . 'm';
}
sub slurp { open my $fh, '<:raw', $_[0] or return undef; local $/; return dec(scalar <$fh> // '') }
# shared, hud and margin.types tables of plugins/margin/hooks/palette.ts DEFAULTS, kept equal by tests/hud.test.sh
my %PALETTE = (
    shared => { label => '#a396d2', faint => '#4f5c68', idle => '#456186', action => '#5d9678', dirty => '#8c7850', churn => '#6e8c6e', muted => '#808286', lit => '#0f1c28', prompt => '#e0a878', flash => '#2f6b45' },
    hud => {
        rampLow => '#0e2042', rampHigh => '#a8d6ff', rampHot => '#ffaa5a', track => '#1e2a3a', note => '#404750', cwdLow => '#4a6b8a', cwdHigh => '#93b4e0',
        profile => '#5f9ea8', version => '#9d6554', divider => '#263240', sweep => '#ffecc8', model => '#7fb6d9', skill => '#93b4e0', thinking => '#a98fd9',
        clock => '#8da6c2', session => undef,
    },
    types => { feat => '#98c379', fix => '#e06c75', refactor => '#61afef', perf => '#d19a66', docs => '#e5c07b', test => '#56b6c2' },
);
# --- caches in the private state dir: $TMPDIR/claudzilla-rules-<uid>, mode 0700, owned by us alone; undef when that fails ---
my $SD;
sub state_dir {
    return $SD if defined $SD;
    my $dir = ($ENV{TMPDIR} || '/tmp') . "/claudzilla-rules-$<";
    mkdir $dir, 0700; my @st = lstat $dir;
    return $SD = $dir if @st && -d _ && $st[4] == $< && !($st[2] & 077);
    return undef;
}
# path|size|inode|mtime|ctime in whole seconds; the list form adds racy: changed in this second, so a same-size rewrite may not move the key. Callers store no entry from a racy read.
sub file_key { my @s = stat($_[0]) or return undef; my $k = join '|', $_[0], @s[7, 1, 9, 10]; return wantarray ? ($k, $s[9] >= $T || $s[10] >= $T) : $k }
# hashref of key => value; undef when the file is missing or any line is not "key<TAB>value"
sub cache_read {
    open my $fh, '<:utf8', $_[0] or return undef;
    my %h;
    for (split /\n/, do { local $/; <$fh> // '' }) { /^([^\t]+)\t(.*)$/ or return undef; $h{$1} = $2 }
    return \%h;
}
# merge over the current file and rename into place; an absent value is written as an empty one
sub cache_write {
    my ($path, $new) = @_;
    my %h = (%{ cache_read($path) // {} }, %$new);
    my $tmp = "$path.$$.tmp";
    open my $fh, '>:utf8', $tmp or return;
    print $fh map { "$_\t" . clean($h{$_}) . "\n" } sort keys %h;
    close $fh and rename $tmp, $path or unlink $tmp;
}
# per-session cache file; the sid keeps [\w-] only, so no dot-named cache can collide with it
sub cache_file {
    my $dir = state_dir() // return undef;
    (my $sid = $_[0] // '') =~ s/[^\w-]//g;
    return "$dir/hud-" . (length $sid ? $sid : 'nosession') . '.cache';
}
# --- shared API spend ledger in the config dir, mode 0600; tab lines: slot <epoch> <usd>, day <date> <usd>, sess <sid> <cost> <seen> ---
sub spend_date { my @t = localtime $_[0]; return sprintf '%04d-%02d-%02d', $t[5] + 1900, $t[4] + 1, $t[3] }
sub spend_load {
    my %st = (slot => {}, day => {}, sess => {});
    open my $fh, '<:utf8', $_[0] or return \%st;
    my ($u, $e) = (qr/\d+(?:\.\d+)?/, qr/\d+/);
    for (split /\n/, do { local $/; <$fh> // '' }) {
        my @f = split /\t/, $_, -1;
        if    (@f == 3 && $f[0] eq 'slot' && $f[1] =~ /^$e\z/ && $f[2] =~ /^$u\z/)                  { $st{slot}{$f[1]} = $f[2] + 0 }
        elsif (@f == 3 && $f[0] eq 'day' && $f[1] =~ /^\d{4}-\d\d-\d\d\z/ && $f[2] =~ /^$u\z/)      { $st{day}{$f[1]} = $f[2] + 0 }
        elsif (@f == 4 && $f[0] eq 'sess' && length $f[1] && $f[2] =~ /^$u\z/ && $f[3] =~ /^$e\z/) { $st{sess}{$f[1]} = [$f[2] + 0, $f[3] + 0] }
    }
    return \%st;
}
# drops slots and sessions older than 48 h and days outside this month; returns how many lines went
sub spend_prune {
    my ($st, $T) = @_;
    my ($n, $cut, $mon) = (0, $T - 172800, substr(spend_date($T), 0, 7));
    for (keys %{ $st->{slot} }) { if ($_ < $cut) { delete $st->{slot}{$_}; $n++ } }
    for (keys %{ $st->{sess} }) { if ($st->{sess}{$_}[1] < $cut) { delete $st->{sess}{$_}; $n++ } }
    for (keys %{ $st->{day} }) { if (substr($_, 0, 7) ne $mon) { delete $st->{day}{$_}; $n++ } }
    return $n;
}
sub spend_save {
    my ($file, $st) = @_;
    my $tmp = "$file.$$.tmp";
    sysopen(my $fh, $tmp, O_WRONLY | O_CREAT | O_TRUNC, 0600) or return 0;
    binmode $fh, ':utf8';
    my @l = ((map { sprintf "slot\t%s\t%.6f\n", $_, $st->{slot}{$_} } keys %{ $st->{slot} }),
             (map { sprintf "day\t%s\t%.6f\n", $_, $st->{day}{$_} } keys %{ $st->{day} }),
             (map { sprintf "sess\t%s\t%.6f\t%d\n", $_, @{ $st->{sess}{$_} } } keys %{ $st->{sess} }));
    print $fh sort @l;
    return 1 if close($fh) && rename $tmp, $file;
    unlink $tmp; return 0;
}
# one tick under an exclusive lock: a delta is counted once however many sessions tick at the same time
sub spend_tick {
    my ($dir, $sid, $cost, $T) = @_;
    my $file = "$dir/claudzilla-spend.tsv";
    return spend_load($file) unless length $sid;
    sysopen(my $lk, "$dir/claudzilla-spend.lock", O_RDWR | O_CREAT, 0600) or return spend_load($file);
    my $got = 0;
    for (1 .. 20) { last if $got = flock($lk, LOCK_EX | LOCK_NB); select(undef, undef, undef, 0.01) }
    return spend_load($file) unless $got;
    my $st = spend_load($file);
    my ($delta, $dirty) = (0, 0);
    my $old = $st->{sess}{$sid};
    if (!$old) { $dirty = 1 }
    elsif (sprintf('%.6f', $cost) ne sprintf('%.6f', $old->[0])) {
        $dirty = 1;
        $delta = $cost - $old->[0] if $cost > $old->[0];
    }
    $dirty = 1 if $old && $old->[1] < $T - 600;
    $st->{sess}{$sid} = [$cost, $T] if $dirty;
    if (sprintf('%.6f', $delta) > 0) {
        # shortcut: slots start on UTC 10-minute marks, so a zone whose offset is not a multiple of 10 min (+5:45, +12:45, +8:45) dates up to 5 min after local midnight into yesterday; upgrade to per-minute or offset-aligned slots
        my $s0 = int($T / 600) * 600;
        $st->{slot}{$s0} += $delta; $st->{day}{ spend_date($s0) } += $delta;
    }
    $dirty = 1 if spend_prune($st, $T);
    return $st unless $dirty;
    # stale temp files of crashed ticks, swept only when this tick writes
    if (opendir my $dh, $dir) {
        for (grep { /^claudzilla-spend\.tsv\.\d+\.tmp\z/ } readdir $dh) { my @s = stat "$dir/$_"; unlink "$dir/$_" if @s && $s[9] < $T - 3600 }
        closedir $dh;
    }
    return spend_save($file, $st) ? $st : spend_load($file);
}
sub spend_figures {
    my ($st, $T) = @_;
    require POSIX;
    my $s0 = int($T / 600) * 600; my $ws = $s0 - 143 * 600;
    my ($today, $mon, @lt) = (spend_date($T), substr(spend_date($T), 0, 7), localtime $T);
    my %f = (today => 0, month => 0, rate => 0);
    $f{today} += $st->{slot}{$_} for grep { spend_date($_) eq $today } keys %{ $st->{slot} };
    $f{month} += $st->{day}{$_} for grep { substr($_, 0, 7) eq $mon } keys %{ $st->{day} };
    $f{rate} += $st->{slot}{$s0 - $_ * 600} // 0 for 0 .. 5;
    $f{day} = $f{month} / $lt[3];
    $f{slots} = [map { $st->{slot}{$ws + $_ * 600} // 0 } 0 .. 143];
    my $mid = POSIX::mktime(0, 0, 0, $lt[3], $lt[4], $lt[5], 0, 0, -1);
    $f{mid} = $mid - $ws if defined $mid && $mid - $ws > 0 && $mid - $ws < 86400;
    return \%f;
}
sub gather {
    my $raw = do { local $/; <STDIN> } // '';
    my $d = json_parse(dec($raw));
    my %out;
    my $sid = str(dig($d, 'session_id')) // '';
    $out{id} = substr($sid, 0, 8);
    $out{sid} = $sid;
    $out{cwd} = truthy(dig($d, 'workspace', 'current_dir')) ? dig($d, 'workspace', 'current_dir') : dig($d, 'cwd');
    $out{effort} = dig($d, 'effort', 'level');
    $out{model} = dig($d, 'model', 'display_name');
    # null until the first API reply; keep the row so the statusline height stays put
    $out{ctx} = pct(dig($d, 'context_window', 'used_percentage')) // 0;
    my $u = dig($d, 'context_window', 'current_usage');
    my $used = count(dig($u, 'input_tokens')) + count(dig($u, 'cache_creation_input_tokens')) + count(dig($u, 'cache_read_input_tokens'));
    if ($used > 0) { $out{ctx_note} = $used >= 999_500 ? round_half_up($used / 1e6 * 10) / 10 . 'M' : round_half_up($used / 1e3) . 'k' }
    elsif ($out{ctx} == 0) { $out{ctx_note} = '0' }
    my $rl = dig($d, 'rate_limits');
    for my $w (['5h', 'five_hour'], ['wk', 'seven_day']) {
        my ($key, $src) = @$w;
        my $lim = dig($rl, $src);
        my $v = pct(dig($lim, 'used_percentage'));
        # Claude Code drops a window after resets_at; dropped = fresh window, 0% used
        $out{$key} = $v // (truthy(dig($rl, 'five_hour')) || truthy(dig($rl, 'seven_day')) ? 0 : undef);
        $out{"${key}_note"} = reset_in(dig($lim, 'resets_at')) if defined $v;
    }
    my $cdir = length $ENV{CLAUDE_CONFIG_DIR} ? $ENV{CLAUDE_CONFIG_DIR} : undef;
    my $cf = cache_file($sid);
    my $c = $cf ? cache_read($cf) // {} : {};
    my %cw;
    my $acct_api = 0;
    my $ap = defined $cdir ? "$cdir/.claude.json" : "$ENV{HOME}/.claude.json";
    my ($ak, $ar) = file_key($ap);
    if (defined $ak && ($c->{acct_key} // '') eq $ak && exists $c->{acct_api}) { $out{profile} = $c->{profile} if length($c->{profile} // ''); $acct_api = $c->{acct_api} }
    else {
        # first + last char of the local part only: tells accounts apart without showing the address on screen
        my $acct = slurp($ap);
        # a file that names oauthAccount (object or null) is subscription: skip the slow pure-Perl parse
        my $parsed = defined $acct && $acct !~ /"oauthAccount"\s*:/ ? json_parse($acct) : undef;
        $acct_api = ref $parsed eq 'HASH' && !exists $parsed->{oauthAccount} ? 1 : 0;
        # shortcut: a nested object or a brace in an earlier oauthAccount field defeats this match, parse the oauthAccount object with json_parse if Claude Code ever nests fields there
        if (defined $acct && $acct =~ /"oauthAccount"\s*:\s*\{[^{}]*?"emailAddress"\s*:\s*"((?:[^"\\]|\\.)*)"/s) {
            my $e = $1;
            $e =~ s/^(.).+(.)@/$1\x{2026}$2@/; $e =~ s/^(.).?@/$1\x{2026}@/;
            $out{profile} = $e;
        }
        @cw{qw(acct_key profile acct_api)} = ($ak, $out{profile} // '', $acct_api) if defined $ak && !$ar;
    }
    my $api = length($ENV{ANTHROPIC_API_KEY} // '') || length($ENV{ANTHROPIC_AUTH_TOKEN} // '') || ($acct_api && ref(dig($d, 'cost')) eq 'HASH');
    # rate_limits only come with subscription billing, whatever the environment says
    $api = 0 if truthy(dig($d, 'rate_limits'));
    if ($api) { delete @out{qw(profile 5h 5h_note wk wk_note)}; $out{login} = api_host($ENV{ANTHROPIC_BASE_URL} // '') // 'api key' }
    if (defined $out{login}) {
        my $cost = count(dig($d, 'cost', 'total_cost_usd'));
        my $sdir = defined $cdir ? $cdir : "$ENV{HOME}/.claude";
        my $sf = spend_figures(spend_tick($sdir, ($out{sid} =~ s/[^\w-]//gr), $cost, $T), $T);
        $out{spend_here} = sprintf '%.6f', $cost;
        $out{"spend_$_"} = sprintf '%.6f', $sf->{$_} for qw(today month rate day);
        $out{spend_slots} = join ',', map { sprintf '%.6f', $_ } @{ $sf->{slots} };
        $out{spend_mid} = $sf->{mid} if defined $sf->{mid};
    }
    # no reply yet: nothing of this chat to lose, show fresh
    $out{cch} = 0; $out{cch_note} = 'hot';
    my $tp = str(dig($d, 'transcript_path'));
    if (truthy(dig($d, 'transcript_path'))) {
        my ($tk, $tr) = file_key($tp);
        my $hit = defined $tk && ($c->{t_key} // '') eq $tk;
        my $start = ($c->{start_path} // '') eq $tp ? $c->{start} // '' : '';
        my ($skill, $last, $ttl, $think) = $hit ? @$c{qw(skill last ttl think_ts)} : ();
        if ((!$hit || !length $start) && open(my $fh, '<:raw', $tp)) {
            my $bytes = -s $fh;
            # whole lines only: a slice cut inside a multi-byte character would send dec() down its slow per-character path
            my $rd = sub {
                my ($from, $len) = @_; seek $fh, $from, 0; my $buf; read $fh, $buf, $len; $buf //= '';
                if ($from > 0) { my $i = index $buf, "\n"; $buf = $i < 0 ? '' : substr $buf, $i + 1 }
                if ($from + $len < $bytes) { my $i = rindex $buf, "\n"; $buf = $i < 0 ? '' : substr $buf, 0, $i + 1 }
                return dec($buf);
            };
            # first timestamped entry = session start
            unless (length $start) {
                for my $line (grep { length } split /\n/, $rd->(0, $bytes < 65536 ? $bytes : 65536)) {
                    my $ts = iso_epoch(dig(json_parse($line), 'timestamp')) or next;
                    $start = $ts; @cw{qw(start_path start)} = ($tp, $ts); last;
                }
            }
            if (!$hit) {
                # shortcut: last-4MB tail only; an older skill is not shown, scan further back if that bites
                my $from = $bytes > 4194304 ? $bytes - 4194304 : 0;
                my $buf = $rd->($from, $bytes - $from);
                undef $skill; undef $last; undef $ttl; undef $think;
                my $blocks = sub { my $c = dig($_[0], 'message', 'content'); return ref $c eq 'ARRAY' ? @$c : () };
                # Prompt cache: each main-chat request restarts its TTL; a pure cache read keeps the TTL the last write chose.
                # Subagents cache apart, and a synthetic reply (API error) sent nothing.
                # shortcut: the reply's timestamp is its end, so a long reply overstates the time left by its length; read the request time if the transcript gains one.
                my ($seen, $think_done);
                # newest line first, one pass; each field stops at its first hit
                for (my $pos = length $buf; $pos > 0 && !(defined $skill && $think_done && defined $ttl);) {
                    my $p = rindex $buf, "\n", $pos - 1;
                    my $line = substr $buf, $p + 1, $pos - $p - 1;
                    $pos = $p < 0 ? 0 : $p;
                    next unless length $line;
                    my $e;
                    if (!defined $skill && index($line, '"Skill"') >= 0) {
                        $e //= json_parse($line);
                        for my $b (reverse $blocks->($e)) {
                            next unless (dig($b, 'type') // '') eq 'tool_use' && (dig($b, 'name') // '') eq 'Skill' && truthy(dig($b, 'input', 'skill'));
                            $skill = dig($b, 'input', 'skill'); last;
                        }
                    }
                    if (!$think_done && $line =~ /"type":"(?:thinking|reasoning)"/) {
                        $e //= json_parse($line);
                        if (grep { (dig($_, 'type') // '') =~ /^(?:thinking|reasoning)\z/ } $blocks->($e)) { $think = iso_epoch(dig($e, 'timestamp')); $think_done = 1 }
                    }
                    if (!defined $ttl && index($line, '"assistant"') >= 0) {
                        $e //= json_parse($line);
                        my $us = dig($e, 'message', 'usage');
                        next unless (dig($e, 'type') // '') eq 'assistant' && !truthy(dig($e, 'isSidechain')) && truthy($us);
                        if (!$seen && count(dig($us, 'input_tokens')) + count(dig($us, 'cache_read_input_tokens')) + count(dig($us, 'cache_creation_input_tokens')) > 0) { $seen = 1; $last = iso_epoch(dig($e, 'timestamp')) }
                        next unless $seen;
                        if (count(dig($us, 'cache_creation', 'ephemeral_1h_input_tokens')) > 0) { $ttl = 3600000 }
                        elsif (count(dig($us, 'cache_creation', 'ephemeral_5m_input_tokens')) > 0) { $ttl = 300000 }
                    }
                }
                @cw{qw(t_key skill last ttl think_ts)} = ($tk, map { $_ // '' } $skill, $last, $ttl, $think) if defined $tk && !$tr;
            }
            close $fh;
        }
        # derived from the saved times on every tick, so an idle transcript never freezes them
        $out{skill} = $skill if length($skill // '');
        $out{up} = ($T > $start ? int(($T - $start) / 60) : 0) . 'm' if length $start;
        $out{thinking} = 1 if length($think // '') && $T - $think <= 30;
        if (length($last // '') && length($ttl // '')) {
            my $sec = $ttl / 1000;
            # clamped: a clock stepped back puts the reply in the future
            my $left = $last + $sec - $T; $left = 0 if $left < 0; $left = $sec if $left > $sec;
            # floor: 100% only once cold
            $out{cch} = int((1 - $left / $sec) * 100);
            $out{cch_note} = $left > 0 ? int(($left + 59) / 60) . 'm' : 'cold';
        } elsif (length($last // '')) {
            # replies but no cache write (caching off): the next message pays for it all
            $out{cch} = 100; $out{cch_note} = 'cold';
        }
    }
    cache_write($cf, \%cw) if $cf && %cw;
    # logged in, no limits yet: they arrive with the next reply (also after /login mid-session), so hold their slots
    $out{lim_wait} = 1 if length($out{profile} // '') && !defined $out{'5h'} && !defined $out{wk};
    my $cfg = json_parse(slurp((defined $cdir ? $cdir : "$ENV{HOME}/.claude") . '/claudzilla.json'));
    my $layout = dig($cfg, 'hud', 'layout');
    $out{layout} = $layout if defined $layout && !ref $layout && ($layout eq 'compact' || $layout eq 'minimal');
    for my $table (keys %PALETTE) {
        for my $key (keys %{ $PALETTE{$table} }) {
            my $set = $table eq 'types' ? dig($cfg, 'palette', 'margin', 'types', $key) : dig($cfg, 'palette', $table, $key);
            # a missing or dropped colour draws grey, so anything but #rrggbb sends the default
            $out{"pal_${table}_$key"} = defined $set && !ref $set && !is_num($set) && $set =~ /^#[0-9a-f]{6}\z/i ? $set : $PALETTE{$table}{$key};
        }
    }
    # C0/C1 control chars (tabs, newlines, terminal escapes in a skill or model name) never reach the terminal
    my %res;
    for my $k (keys %out) { my $v = str($out{$k}); next unless defined $v && length $v; $res{$k} = clean($v) }
    return \%res;
}
if ($ENV{HUD_DUMP}) { my $o = gather(); print "$_\t$o->{$_}\n" for sort keys %$o; exit }

# no terminal width in the statusline JSON: trust COLUMNS, else ask the tty, else assume 114
my $W = 114;
{   my $cols = $ENV{COLUMNS};
    unless ($cols && $cols =~ /^\d+$/ && $cols > 20) {
        ($cols) = (`stty size < /dev/tty 2>/dev/null` // '') =~ /^\d+\s+(\d+)/;
    }
    $W = $cols - 4 if $cols && $cols =~ /^\d+$/ && $cols > 20;
}

# install.sh leaves this marker when the user declines MesloLGS NF: fall back to symbols every mono font has
my ($G_ON, $G_OFF, $G_BRANCH, $G_SKILL, $G_CACHE) =
    -e (($ENV{CLAUDE_CONFIG_DIR} // "$ENV{HOME}/.claude") . '/.claudzilla-basic-glyphs')
    ? ("\x{25A0}", "\x{25A1}", "\x{203A}", "\x{25B8}", "\x{25A0}")
    : ("\x{25B0}", "\x{25B1}", "\x{2387}", "\x{2691}", "\x{25AC}");

my %f = %{ $ENV{HUD_KV} ? read_kv() : gather() };
# hud.pl pal_<table>_<key> lines: "<table>_<key>" -> [r, g, b]
my %PAL = map { $f{$_} =~ /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i ? (substr($_, 4) => [map { hex } $1, $2, $3]) : () } grep { /^pal_/ } keys %f;
sub pal { $PAL{$_[0]} // [128,128,128] }
sub fg { "\e[38;2;" . join(';', @{ pal($_[0]) }) . "m" }
my ($id, $META_CWD, $EFFORT, $SID) = @f{qw(id cwd effort sid)};
my ($COMPACT, $MIN) = map { ($f{layout} // '') eq $_ } qw(compact minimal);
# session name (/rename, or derived like "maxis-24") - the handle peers message us by.
# Not in the statusline JSON, so look it up in the per-pid session registry.
my $sname;
if ($SID) {
    my $dir = ($ENV{CLAUDE_CONFIG_DIR} // "$ENV{HOME}/.claude") . '/sessions';
    my $cf = cache_file($SID);
    my $c = $cf ? cache_read($cf) // {} : {};
    my $sk = $c->{s_key} // '';
    my ($dk, $dr) = file_key($dir);
    if (length $sk && $sk =~ /^(.*)\|[^|]*\|[^|]*\|[^|]*\|[^|]*\z/ && (file_key($1) // '') eq $sk) { $sname = $c->{name} }
    # no-match memo also expires after 60 s: an in-place rewrite of a sessions file may not move the dir mtime
    elsif (defined $dk && ($c->{dir_key} // '') eq $dk && ($c->{nm_at} // '') =~ /^\d+\z/ && abs($T - $c->{nm_at}) <= 60) { }
    else {
        my ($fk, $found);
        for my $file (glob "$dir/*.json") {
            my ($k, $kr) = file_key($file);
            open my $fh, '<', $file or next;
            my $j = dec(do { local $/; <$fh> } // '');
            close $fh;
            next unless index($j, $SID) >= 0;
            ($sname) = $j =~ /"name":"([^"]*)"/;
            $sname = clean($sname);
            $found = 1; $fk = $k unless $kr;
            last;
        }
        if ($cf) {
            if (defined $fk) { cache_write($cf, { s_key => $fk, name => $sname // '', dir_key => '', nm_at => '' }) }
            elsif (!$found && defined $dk && !$dr) { cache_write($cf, { dir_key => $dk, nm_at => $T, s_key => '', name => '' }) }
        }
    }
    undef $sname unless length($sname // '');
}
my $cwd;
if (my $e = $META_CWD) { my $h = $ENV{HOME} // ''; utf8::decode($h); $e =~ s/^\Q$h\E(?=\/|$)/~/ if $h; $cwd = $e; }
my $profile = $f{login} // $f{profile};
my $API = defined $f{login};
# claudzilla version from the clone this script links into: the last release tag, or, when the
# clone runs ahead of it, the tag CI would cut next (same script as .github/workflows/test.yml)
my $ver;
{   # cached per clone, keyed by the script's dir as invoked, for 60 s: a new commit or tag shows within a minute
    my ($hd0) = $0 =~ m{^(.*)/}; $hd0 //= '.';
    my $h = 2166136261; for (unpack 'C*', $hd0) { $h ^= $_; $h = ($h * 16777619) & 0xffffffff }
    my $sd = state_dir();
    my $vf = $sd ? sprintf('%s/hud-ver-%08x', $sd, $h) : undef;
    my $c = $vf ? cache_read($vf) // {} : {};
    if (($c->{at} // '') =~ /^\d+\z/ && abs($T - $c->{at}) <= 60 && exists $c->{ver}) { $ver = $c->{ver} }
    else {
        require Cwd;
        my ($hd) = (Cwd::abs_path($0) // '') =~ m{^(.*)/};
        $hd =~ s/'/'\\''/g if defined $hd;
        my $last = defined $hd ? `git -C '$hd' describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null` // '' : '';
        $last =~ s/\s+$//;
        if (length $last) {
            (my $q = $last) =~ s/'/'\\''/g;
            my $next = `git -C '$hd' log --format='%s%n%b' '$q..HEAD' 2>/dev/null | sh '$hd/../../.github/next-version.sh' '$q' 2>/dev/null` // '';
            $next =~ s/\s+$//;
            $ver = clean(length $next ? $next : $last);
        }
        cache_write($vf, { at => $T, ver => $ver // '' }) if $vf;
    }
    undef $ver unless length($ver // '');
}
# branch + dirty from the session cwd; blank when not a repo
my ($branch, $dirty);
if ($META_CWD) {
    my $d = $META_CWD; utf8::encode($d);
    my ($m, $u) = (0, 0);
    for (split /\n/, dec(git_out('--no-optional-locks', '-C', $d, 'status', '--porcelain=v2', '--branch'))) {
        if (/^# branch\.head (.*)$/) { $branch = $1 eq '(detached)' ? undef : clean($1); $branch = undef unless length $branch }
        elsif (/^\?/) { $u++ }
        elsif (/^[12u]/) { $m++ }
    }
    $dirty = join ' ', ($m ? "!$m" : ()), ($u ? "?$u" : ()) if $branch;
}
my ($model, $session, $skill, $thinking) = @f{qw(model up skill thinking)};

my %mv = map { $_ => [$_, $f{$_}, $f{"${_}_note"} // ''] } grep { ($f{$_} // '') =~ /^\d+$/ } qw(ctx cch 5h wk);
# limits not in yet: blank meters keep the layout from jumping on the first reply. Note is 5 wide, mid-range for a reset time (2h5m to 23h59m).
if ($f{lim_wait}) { $mv{$_} //= [$_, undef, sprintf('%5s', '--')] for qw(5h wk) }

# --- helpers ---------------------------------------------------------------
# terminal cells: East Asian wide chars take two
sub vis { my $s = shift; $s =~ s/\e\[[0-9;]*m//g; return length($s) + (() = $s =~ /[\p{EA=W}\p{EA=F}]/g) }
sub pad {                       # left, right -> line padded to $W
    my ($l,$r,$fill) = @_; $fill //= ' ';
    my $gap = $W - vis($l) - vis($r); $gap = 1 if $gap < 1;
    return $l . "\e[2m" . ($fill x $gap) . "\e[0m" . $r;
}
sub fits { my ($l,$r) = @_; return vis($l) + vis($r) + ($r ne '' ? 2 : 0) <= $W }
sub paint {                     # [char, r, g, b] cells -> string, colour code only where it changes
    my ($out,$prev) = ('','');
    for (@_) {
        my ($ch,@c) = @$_;
        my $seq = "\e[38;2;" . join(';', map { int($_ + 0.5) } @c) . "m";
        $out .= ($seq eq $prev ? '' : $seq) . $ch;
        $prev = $seq;
    }
    return $out . "\e[0m";
}
my @A = @{ pal('hud_rampLow') }; my @B = @{ pal('hud_rampHigh') };  # blue ramp, dark -> bright
my @O = @{ pal('hud_rampHot') };                                     # ...then warm over the last 30% of the track
sub ramp {
    my $x = shift;                                    # 0..1, already eased
    return $x < 0.7 ? [ map { $A[$_] + ($B[$_]-$A[$_]) * ($x/0.7) } 0..2 ]
                    : [ map { $B[$_] + ($O[$_]-$B[$_]) * (($x-0.7)/0.3) } 0..2 ];
}
# builds a whole meter row: title, bar, figure and note
sub meter_line {
    my ($label,$pct,$note,$n,$tw,$lw,$pw) = @_;
    my $wait = !defined $pct; $pct //= 0;
    my $f = int($pct / 100 * $n + 0.5); $f = $n if $f > $n;
    # cache is a clock, not a fill: a solid full bar in one ramp colour, dim blue when fresh to orange when cold
    my $cc = $label eq 'cch' ? cch_colour($pct) : undef;
    $f = $n if $cc;
    my @cell;
    push @cell, [$_, pal('shared_label')] for split //, sprintf('%-*s ', $lw, $label); # title
    push @cell, bar_cells($n, $f, $cc);                                       # bar
    push @cell, [$_, fig_colour($pct, $wait, $cc)] for split //, sprintf(' %*s%%  ', $pw, $wait ? '--' : $pct);   # figure
    push @cell, [$_, pal('hud_note')] for split //, sprintf("%*s", $tw, $note);    # note
    return cells_str(@cell);
}
sub bar_cells {                 # $n cells, $f lit; $cc: one solid colour (the cache clock)
    my ($n,$f,$cc) = @_;
    return map { my $on = $_ < $f;
                 [$cc ? $G_CACHE : $on ? $G_ON : $G_OFF,
                  $on ? $cc // [map { int($_+0.5) } @{ ramp(($n > 1 ? $_/($n-1) : 1) ** 0.85) }] : pal('hud_track')] } 0 .. $n-1;
}
sub fig_colour {
    my ($pct,$wait,$cc) = @_;
    my $x = ($pct/100) ** 0.85; $x = 0.4 if $x < 0.4;
    return $wait ? pal('hud_note') : $cc // [map { int($_+0.5) } @{ ramp($x) }];
}
sub cch_colour { [map { int($_+0.5) } @{ ramp(0.1 + 0.9 * ($_[0]/100) ** 0.85) }] }
sub chart_cells {
    my $n = shift;
    my @sl = length($f{spend_slots} // '') ? split(/,/, $f{spend_slots}) : ();
    push @sl, 0 while @sl < 144;
    my $mid = $f{spend_mid};
    my $N = defined $mid ? $n - 1 : $n; my $L;
    if (defined $mid) { $L = int($N * $mid / 86400 + 0.5); $L = $N - 1 if $L > $N - 1; $L = 1 if $L < 1 }
    my $R = defined $mid ? $N - $L : 0;
    my @sum = (0) x $N;
    for my $k (0 .. 143) {
        my $o = 600 * $k;
        my $c = !defined $mid ? int($k * $N / 144) : $o < $mid ? int($o * $L / $mid) : $L + int(($o - $mid) * $R / (86400 - $mid));
        $sum[$c] += $sl[$k];
    }
    my ($min, $max) = ($sum[0], $sum[0]);
    for (@sum) { $min = $_ if $_ < $min; $max = $_ if $_ > $max }
    my @g = split //, "\x{2581}\x{2582}\x{2583}\x{2584}\x{2585}\x{2586}\x{2587}\x{2588}";
    my @cells = map {
        if ($max > $min) { my $lv = ($_ - $min) / ($max - $min); [$g[int($lv * 7 + 0.5)], cch_colour(int($lv * 100 + 0.5))] }
        else { [$g[0], pal('hud_track')] }
    } @sum;
    splice @cells, $L, 0, ["\x{254E}", pal('hud_clock')] if defined $mid;
    return @cells;
}
sub chart_row {
    my $w = shift;
    my $nt = sub { map { [$_, pal('hud_note')] } split //, $_[0] };
    return cells_str($nt->('24h ago '), chart_cells($w - 12), $nt->(' now'));
}
sub money_cells { my ($v, $c) = @_; return map { [$_, $c] } split //, sprintf('$%.2f', $v) }
sub spend_colours {
    my $f = shift;
    my $pct = $f->{spend_day} > 0 ? ($f->{spend_today} / $f->{spend_day} - 0.5) * 100 : 0;
    $pct = 0 if $pct < 0; $pct = 100 if $pct > 100;
    return { here => ramp(0.85), today => cch_colour($pct), month => ramp(0.6),
             rate => pal('shared_muted'), day => pal('shared_muted') };
}
sub words_cells {
    my $w = shift;
    my $c = spend_colours(\%f); my $nc = pal('hud_note');
    my $grp = sub {   # [[figure, unit-or-label, label?]...] -> cells joined by two spaces
        my @o;
        for my $p (@_) {
            push @o, [' ', $nc], [' ', $nc] if @o;
            push @o, money_cells($f{"spend_$p->[0]"}, $c->{$p->[0]});
            push @o, map { [$_, $nc] } split //, $p->[1];
        }
        return @o;
    };
    my %t = (here => ' here', today => ' today', month => ' month', rate => '/h', day => '/day');
    # shed order: per day, month, rate, today; here stays
    for my $drop ([], ['day'], ['day','month'], ['day','month','rate'], ['day','month','rate','today']) {
        my %x = map { $_ => 1 } @$drop;
        my @l = $grp->(map { [$_, $t{$_}] } grep { !$x{$_} } qw(here today month));
        my @r = $grp->(map { [$_, $t{$_}] } grep { !$x{$_} } qw(rate day));
        my $gap = $w - @l - @r;
        next if $gap < (@r ? 1 : 0);
        return cells_str(@l, (map { [' ', $nc] } 1 .. $gap), @r);
    }
    my @l = $grp->(['here', $t{here}]);
    return cells_str(@l[0 .. ($w < @l ? $w : scalar @l) - 1], map { [' ', $nc] } 1 .. ($w - @l > 0 ? $w - @l : 0));
}
sub text_cells {
    my $w = shift;
    my $nc = pal('hud_note'); my $c = spend_colours(\%f);
    my @a = (money_cells($f{spend_here}, $c->{here}), map { [$_, $nc] } split //, ' here');
    my @b = (money_cells($f{spend_month}, $c->{month}), map { [$_, $nc] } split //, ' month');
    my $spare = $w - @a - @b - 3;
    return () if $spare < 0;
    my @g = map { int(($spare + 2 - $_) / 3) } 0 .. 2;   # spare cells split into three gaps, extras to the earlier ones
    my $sp = sub { map { [' ', $nc] } 1 .. $_[0] };
    return cells_str($sp->(1 + $g[0]), @a, $sp->(1 + $g[1]), @b, $sp->(1 + $g[2]));
}
sub cells_str { return paint(map { [$_->[0], @{$_->[1]}] } @_) }   # [char, colour] cells -> string
my $dim = sub { "\e[2m$_[0]\e[0m" };
# meter titles: muted lilac - clear of the teal profile and the blue->orange ramp

my @out;

# identity: path + branch + session id, profile flush right
sub cwd_str {
    my $text = shift;
    # by default hud_cwdLow equals the theme's promptBorder, so ~/ and / take the border colour
    my $sep = fg('hud_cwdLow');
    my $s = $text =~ s{^(~(?:/|\z))}{} ? "$sep$1" : "";
    my ($lo, $hi) = (pal('hud_cwdLow'), pal('hud_cwdHigh'));
    my @c = map { int($lo->[$_] + ($hi->[$_]-$lo->[$_])*0.5 + 0.5) } 0..2;   # halfway between low and high
    for my $ch (split //, $text) {
        if ($ch eq '/') { $s .= "$sep/"; next }
        $s .= "\e[38;2;$c[0];$c[1];$c[2]m$ch";
    }
    return $s . "\e[0m";
}
# ⎇ draws 2 cells wide in 1, so a second space keeps the gap; the name as margin's Git tab draws it
# (chore in shared.label, as margin's TYPES adds it)
my $branch_str = sub { my ($t, $type, $rest) = $_[0] =~ m{^(([^/]+)/)?(.*)\z}s;
                       my $c = !defined $t ? undef : $type eq 'chore' ? 'shared_label' : $PAL{"types_$type"} ? "types_$type" : 'shared_faint';
                       $dim->('  ') . fg('shared_action') . $G_BRANCH . ($G_BRANCH eq "\x{2387}" ? '  ' : ' ') . "\e[0m"
                       . (defined $c ? fg($c) . "$t\e[0m" : '') . $rest };
my $dirty_str = sub { $dim->(' ') . join '', map { fg(/^\?/ ? 'shared_faint' : 'shared_dirty') . " $_\e[0m" } split / /, $_[0] };
# path trimmed from the left until it takes at most $room cells
sub trim_path { my ($path, $room) = @_; $path = substr($path, 1) while vis($path) > $room - 1; return "\x{2026}$path" }
unless ($MIN) {   # narrow panes: shed the least important pieces, then trim the path itself
    my $path = $cwd // '~';
    my $p    = $profile // '';
    my @opt = ( [$branch, $branch_str], [$dirty, $dirty_str] );
    my $build = sub {
        my $l = cwd_str($path);
        for my $o (@opt) { $l .= $o->[1]->($o->[0]) if defined $o->[0] }
        my $r = $p ne '' ? fg('hud_profile') . "$p\e[0m" : '';
        $r .= ($r ne '' ? $dim->('  ') : '') . fg('hud_version') . "$ver\e[0m" if defined $ver;
        return ($l, $r);
    };
    my $fits = sub { fits($build->()) };
    if (!$fits->()) { $ver = undef }                         # version first
    if (!$fits->()) { $p =~ s/\@.*// }                       # profile: local part only
    if (!$fits->()) { $p = '' }                              # ...then drop it
    for my $i (1,0) { last if $fits->(); $opt[$i][0] = undef }     # dirty, branch
    if (!$fits->() && length($path) > 4) {                    # finally trim the path from the left
        my $room = $W - 1;
        $path = trim_path($path, $room) if $room > 2;
    }
    my ($l,$r) = $build->();
    push @out, pad($l, $r);
}

my $note_w = sub { my $w = 0; for (grep { defined } @mv{@_}) { $w = length $_->[2] if length $_->[2] > $w } $w };
my $tw = $note_w->(qw(ctx cch 5h wk));
# two columns, ctx over cache | 5h over wk, when each half keeps a usable bar; else one meter per row.
# Each column right-aligns its own notes.
my @one = grep { defined } @mv{qw(ctx cch 5h wk)};
# a fixed note width of 5, not $tw: the row count must not flip as a reset countdown changes length
my $NC = $API ? 4 : @one;   # API compact cells: cch, ctx, text, chart
my $TXW = int(($W - 9) * 3 / 4) - int(($W - 9) * 2 / 4);   # API text cell width
my $ONE = $COMPACT && $NC && int(($W - 3 * ($NC - 1)) / $NC) - 11 - 5 >= 8
    && (!$API || text_cells($TXW));
my $CL = int(($W - 3) / 2); my $CRW = $W - 3 - $CL;
my $TWO = !$ONE && ($mv{'5h'} || $mv{wk} || $API) && $CL - 11 - $tw >= 8;
my ($twl, $twr) = $TWO ? ($note_w->(qw(ctx cch)), $note_w->(qw(5h wk))) : ($tw, $tw);
my @m = $ONE || $MIN ? () : $TWO ? grep { defined } @mv{qw(ctx cch)} : @one;
my $n  = ($TWO ? $CL : $W) - 4 - 5 - 2 - $twl;

my @DAY = qw(Sun Mon Tue Wed Thu Fri Sat);
my @MON = qw(Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec);
sub rule {
    my $label = shift // '';
    my $start = int(($W - length($label)) / 2);
    my @px;
    for my $i (0 .. $W-1) {
        my $ch = "\x{2501}";
        my @b  = @{ pal('hud_divider') };      # hairline
        if (length $label && $i >= $start && $i < $start + length $label) {
            $ch = substr($label, $i - $start, 1);
            @b  = $ch eq ' ' ? (13,18,24) : @{ pal('hud_clock') };  # inset clock / date
        }
        push @px, [$ch, @b];
    }
    return paint(@px);
}
push @out, rule(sprintf(' %02d:%02d ', @lt[2,1])) unless $f{layout};

my $DIV = " " . fg('hud_divider') . "\x{2503}\e[0m ";
if ($MIN) {
    # place + model left, meters right; shed pieces until both fit, in the order the guide lists
    my $path = $cwd // '~';
    my ($br, $dt, $mo, $notes) = ($branch, $dirty, $model, 1);
    my @ms = grep { defined } @mv{qw(cch ctx 5h wk)};
    my $bar = 12;
    my $sp = 2;   # spend: 2 here and month, 1 here with label, 0 figure only, -1 none
    my $left = sub {
        my $l = cwd_str($path) . (defined $br ? $branch_str->($br) : '') . (defined $dt && $dt ne '' ? $dirty_str->($dt) : '');
        $l .= '  ' . fg('hud_model') . $mo . "\e[0m" . ($EFFORT ? "\e[2m  $EFFORT\e[0m" : '') if defined $mo;
        return $l;
    };
    my $right = sub {
        my @parts;
        for my $m (@ms) {
            my ($label, $pct, $note) = @$m;
            my $wait = !defined $pct;
            ($note //= '') =~ s/^ +//;
            my @cell = map { [$_, pal('shared_label')] } split //, "$label ";
            if ($label eq 'cch') {          # minutes left, in its bar's ramp colour; 3 wide so the row holds still
                my $t = $note =~ /^\d+m$/ ? $note : $note eq 'cold' ? '0m' : '--';
                push @cell, map { [$_, $t eq '--' ? pal('hud_note') : cch_colour($pct)] } split //, sprintf('%3s', $t);
            } else {
                my $f = int(($pct // 0) / 100 * $bar + 0.5); $f = $bar if $f > $bar;
                push @cell, bar_cells($bar, $f), ($bar ? [' ', pal('hud_note')] : ());
                # fixed widths, as compact: a digit more must not move the meters or flip what fits
                push @cell, map { [$_, fig_colour($pct // 0, $wait)] } split //, sprintf('%3s%%', $wait ? '--' : $pct);
                push @cell, map { [$_, pal('hud_note')] } split //, sprintf(' %5s', $note) if $notes && $note ne '';
            }
            push @parts, cells_str(@cell);
        }
        if ($API && $sp >= 0) {
            my ($c, $nc) = (spend_colours(\%f), pal('hud_note'));
            my $lbl = sub { map { [$_, $nc] } split //, $_[0] };
            push @parts, cells_str(money_cells($f{spend_here}, $c->{here}), ($sp ? $lbl->(' here') : ()),
                ($sp > 1 ? ($lbl->('  '), money_cells($f{spend_month}, $c->{month}), $lbl->(' month')) : ()));
        }
        return join $DIV, @parts;
    };
    my $fits = sub { fits($left->(), $right->()) };
    for (8, 5, 3, 0) { last if $fits->(); $bar = $_ }                      # bars shrink, then go
    $mo =~ s/\s+[\d.]+$// if defined $mo && !$fits->();                    # model version
    @ms = grep { $_->[0] ne 'wk' } @ms unless $fits->();                     # weekly meter
    $sp = 1 unless $fits->();                                                # spend: month
    $sp = 0 unless $fits->();                                                # spend: here label
    $dt = undef unless $fits->();                                            # changes
    $notes = 0 unless $fits->();                                             # reset times, token count
    $mo = undef unless $fits->();                                            # model and effort
    $br = undef unless $fits->();                                            # branch
    $sp = -1 unless $fits->();                                               # spend: gone
    for my $l (qw(5h cch)) { last if $fits->(); @ms = grep { $_->[0] ne $l } @ms }   # ctx stays
    if (!$fits->() && length($path) > 4) {                                   # finally trim the path from the left
        my $room = $W - vis($right->()) - 2;
        $path = trim_path($path, $room) if $room > 2;
    }
    push @out, pad($left->(), $right->());
} elsif ($ONE) {
    @one = $API ? map { $mv{$_} // [$_, undef, ''] } qw(cch ctx)
                : grep { defined } @mv{qw(cch ctx 5h wk)};     # the three usage fills sit together, the cache clock apart
    my $room = $W - 3 * ($NC - 1);
    my @cols;
    for my $i (0 .. $#one) {
        my $col = int($room * ($i + 1) / $NC) - int($room * $i / $NC);
        my ($label, $pct, $note) = @{$one[$i]};
        $note =~ s/^ +//;
        # 2 spaces around the bar; it takes what short text leaves, so no uneven gaps
        my ($lw, $pw, $nw) = (1 + length $label, 1 + length($pct // '--'), length $note);
        push @cols, meter_line($label, $pct, $note, $col - 5 - $lw - $pw - $nw, $nw, $lw, $pw);
    }
    if ($API) {
        @cols = (@cols, text_cells($TXW), cells_str(chart_cells($room - int($room * 3 / 4))));
    }
    push @out, join($DIV, @cols);
} elsif ($TWO) {
    # a missing meter leaves its slot blank
    my $nr = $CRW - 4 - 5 - 2 - $twr;
    for my $i (0, 1) {
        my ($l, $r) = ($mv{(qw(ctx cch))[$i]}, $mv{(qw(5h wk))[$i]});
        push @out, ($l ? meter_line(@$l, $n, $twl, 3, 3) : ' ' x $CL)
                 . $DIV
                 . ($API ? ($i ? chart_row($CRW) : words_cells($CRW)) : $r ? meter_line(@$r, $nr, $twr, 3, 3) : ' ' x $CRW);
    }
} else {
    for my $r (@m) {
        my ($label,$pct,$note) = @$r;
        push @out, meter_line($label, $pct, $note, $n, $tw, 3, 3);
    }
    push @out, words_cells($W), chart_row($W) if $API;
}

push @out, rule(sprintf(' %s %02d %s ', $DAY[$lt[6]], $lt[3], $MON[$lt[4]])) unless $f{layout};

# activity: model, skill, thinking; uptime flush right
unless ($MIN) {   # same treatment as the identity row, measured on the rendered strings
    my $mo = $model;
    $mo .= "\e[0m\e[2m  $EFFORT\e[0m" if defined $mo && $EFFORT;   # reset drops hud_model, which wraps $mo below
    my @L = ( [$mo,       sub { fg('hud_model') . "$_[0]\e[0m" }],
              [$skill,    sub { fg('hud_skill') . "$G_SKILL $_[0]\e[0m" }],
              [$thinking, sub { fg('hud_thinking') . "\x{25C7} thinking\e[0m" }] );
    my $clock = $COMPACT ? sprintf('%02d:%02d %s %02d %s', @lt[2,1], $DAY[$lt[6]], $lt[3], $MON[$lt[4]]) : undef;
    my @R = ( [$clock,    sub { fg('hud_clock') . "$_[0]\e[0m" }],
              [$sname,    sub { (exists $PAL{hud_session} ? fg('hud_session') : "\e[38;5;109m") . "$_[0]\e[0m" }],
              [$id,       sub { fg('shared_faint') . "$_[0]\e[0m" }],
              [$session,  sub { fg('shared_idle') . "up $_[0]\e[0m" }] );
    my $build = sub {
        my $j = $dim->('  ');
        return (join($j, map { $_->[1]->($_->[0]) } grep { $_->[0] } @L),
                join($j, map { $_->[1]->($_->[0]) } grep { $_->[0] } @R));
    };
    my $fits = sub { fits($build->()) };
    $R[0][0] = undef unless $fits->();                            # clock
    for my $i (2,1) { last if $fits->(); $L[$i][0] = undef }     # thinking, skill
    for my $i (2,1) { last if $fits->(); $R[$i][0] = undef }      # session id, then name
    $L[0][0] = undef unless $fits->();                            # model, last resort
    my ($ls,$rs) = $build->();
    push @out, pad($ls, $rs);
}

print join("\n", @out), "\n";

# Trace what the line shows, only when a field changed. State is compared before the writer is loaded, so an unchanged tick costs one small read.
eval {
    my %now = (branch => $branch, dirty => $dirty, ver => $ver, cwd => $cwd, name => $sname, skill => $skill,
               model => $model, effort => $EFFORT, ctx => $f{ctx}, '5h' => $f{'5h'}, wk => $f{wk});
    delete @now{grep { !defined $now{$_} || $now{$_} eq '' } keys %now};
    # Private per-user dir, as in rules-guard.mjs: no state and no trace when it isn't ours alone.
    my $dir = state_dir() // die;
    (my $sid = $SID // '') =~ s/[^\w-]//g;
    my $sf = "$dir/hud-" . (length $sid ? $sid : 'nosession');
    my %was;
    if (open my $fh, '<:utf8', $sf) { %was = map { /^([^\t]+)\t(.*)$/ ? ($1, $2) : () } split /\n/, do { local $/; <$fh> // '' }; close $fh; }
    my @chg = grep { ($now{$_} // '') ne ($was{$_} // '') } keys %{{ %now, %was }};
    if (@chg) {
        if (open my $fh, '>:utf8', $sf) { print $fh map { "$_\t$now{$_}\n" } sort keys %now; close $fh; }
        require(($0 =~ m{^(.*)/} ? $1 : '.') . '/../hooks/trace.pl');
        trace_write({ session => $sid, part => 'hud', event => 'hud.change',
                      data => { changed => { map { $_ => $now{$_} // '' } @chg }, prev => { map { $_ => $was{$_} } grep { exists $was{$_} } @chg } } });
    }
};
