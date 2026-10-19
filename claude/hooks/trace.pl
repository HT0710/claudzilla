# Perl twin of trace.mjs: same file naming, masking, cut, rotation and .off check. Never dies.
# Use: require "$RealBin/trace.pl"; trace_write({session=>..., part=>..., event=>..., data=>{...}});
# CLI: perl trace.pl <session> <part> <event> <level> [key=value ...]
use strict;
use warnings;

my $TRACE_DIR = ($ENV{CLAUDE_CONFIG_DIR} || ($ENV{HOME} // '') . "/.claude") . "/claudzilla-trace";
my ($ROTATE, $CUT, $EVERY) = (5 * 1024 * 1024, 2000, 100);
my @SECRETS = (
  qr/sk-[A-Za-z0-9_-]{20,}/, qr/gh[pousr]_[A-Za-z0-9]{36,}/, qr/github_pat_[A-Za-z0-9_]{22,}/, qr/AKIA[0-9A-Z]{16}/,
  qr/Bearer\s+[A-Za-z0-9._~+\/-]+=*/, qr/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  qr/[A-Fa-f0-9]{48,}/, qr/[A-Za-z0-9+\/]{48,}={0,2}/,
);
my $JSON;
my ($writes, %checked) = (0);

# Home first: a long home path would otherwise trip the base64 pattern.
sub trace_mask {
  my ($s) = @_;
  my $h = $ENV{HOME} // '';
  $s =~ s/\Q$h\E/~/g if length $h;
  $s =~ s/$_/[masked]/g for @SECRETS;
  return $s;
}

sub _clean {
  my ($v) = @_;
  my $r = ref $v;
  if (!$r && defined $v && !JSON::PP::is_bool($v)) {
    # Mask by content, not type: a string used as a number keeps its secret. Unchanged values stay as given, so numbers stay numbers.
    my $o = "$v";
    my $s = $o;
    utf8::decode($s) unless utf8::is_utf8($s);
    my $m = trace_mask($s);
    $m = substr($m, 0, $CUT) . "\x{2026}[cut]" if length $m > $CUT;
    return $m ne $o ? $m : $v;
  }
  return [map { _clean($_) } @$v] if $r eq 'ARRAY';
  return { map { $_ => _clean($v->{$_}) } keys %$v } if $r eq 'HASH';
  return $v;
}

sub _safe { my ($s, $d) = @_; $s = '' unless defined $s; $s =~ s/[^A-Za-z0-9_-]//g; return length $s ? $s : $d; }

sub _ts {
  my ($s, $us) = Time::HiRes::gettimeofday();
  my @t = gmtime $s;
  return sprintf("%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", $t[5] + 1900, $t[4] + 1, @t[3, 2, 1, 0], $us / 1000);
}

sub trace_write {
  my ($entry) = @_;
  my $id;
  local $@;
  eval {
    $entry = {} unless ref $entry eq 'HASH';
    $id = $entry->{id} // sprintf("%08x", int(rand(4294967296)));
    return if -e "$TRACE_DIR/.off";
    # Loaded here so a caller that never traces, or has tracing off, pays nothing.
    require JSON::PP; require Time::HiRes; require Fcntl;
    $JSON ||= JSON::PP->new->utf8->allow_nonref;
    my $file = "$TRACE_DIR/" . _safe($entry->{session}, 'nosession') . "." . _safe($entry->{part}, 'part') . ".jsonl";
    mkdir $TRACE_DIR, 0700 unless -d $TRACE_DIR;
    if (!$checked{$file} || ++$writes % $EVERY == 0) {
      $checked{$file} = 1;
      if ((-s $file // 0) > $ROTATE) { (my $old = $file) =~ s/\.jsonl$/.1.jsonl/; rename $file, $old; }
    }
    my %e = (ts => _ts(), %$entry, id => $id, level => $entry->{level} // 'info');
    $e{data} = _clean($e{data}) if defined $e{data};
    sysopen(my $fh, $file, Fcntl::O_WRONLY() | Fcntl::O_APPEND() | Fcntl::O_CREAT(), 0600) or return;
    syswrite $fh, $JSON->encode(\%e) . "\n";
    close $fh;
  };
  return $id // '';
}

unless (caller) {
  my ($session, $part, $event, $level, @kv) = @ARGV;
  my %data;
  for (@kv) { next unless /^([^=]+)=(.*)$/s; $data{$1} = $2; }
  trace_write({ session => $session, part => $part, event => $event, level => $level, data => \%data })
    if defined $event;
  exit 0;
}

1;
