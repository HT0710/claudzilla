"""Convert tmux `capture-pane -e` output (SGR colors) to a standalone HTML page."""
import html, re, sys, unicodedata

BASE16 = ["#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5",
          "#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#ffffff"]


def c256(n):
    if n < 16:
        return BASE16[n]
    if n < 232:
        n -= 16
        v = [0, 95, 135, 175, 215, 255]
        return "#%02x%02x%02x" % (v[n // 36], v[n // 6 % 6], v[n % 6])
    g = 8 + (n - 232) * 10
    return "#%02x%02x%02x" % (g, g, g)


def mask(text, strs):
    """Blank each string, and a cut-off prefix of 8+ chars at a line end, to equal-width spaces."""
    parts = re.split(r"(\x1b\[[0-9;:]*m)", text)
    plain = "".join(p for p in parts if not p.startswith("\x1b["))
    hide = [False] * len(plain)
    for s in strs:
        for m in re.finditer(re.escape(s), plain):
            hide[m.start():m.end()] = [True] * len(s)
        for m in re.finditer(r"[^\n]+", plain):
            line = m.group().rstrip()
            for k in range(len(s) - 1, 7, -1):
                if line.endswith(s[:k]):
                    end = m.start() + len(line)
                    hide[end - k:end] = [True] * k
                    break
    out, i = [], 0
    for p in parts:
        if not p.startswith("\x1b["):
            p = "".join(" " if hide[i + j] else c for j, c in enumerate(p))
            i += len(p)
        out.append(p)
    return "".join(out)


def convert(text, fg0, bg0):
    out, st = [], {}
    for part in re.split(r"(\x1b\[[0-9;:]*m)", text):
        if not part.startswith("\x1b["):
            if part:
                css = []
                fg, bg = st.get("fg"), st.get("bg")
                if st.get("rev"):
                    fg, bg = bg or bg0, fg or fg0
                if fg: css.append("color:" + fg)
                if bg: css.append("background:" + bg)
                if st.get("b"): css.append("font-weight:bold")
                if st.get("i"): css.append("font-style:italic")
                if st.get("u"): css.append("text-decoration:underline")
                if st.get("d"): css.append("opacity:.6")
                # A glyph the font lacks comes from a fallback font at its own width; pin it to the cells tmux gave it.
                t = re.sub(r"[^\x00-\x7f]", lambda m: f'<span class="c{2 if unicodedata.east_asian_width(m[0]) in "WF" else 1}">{m[0]}</span>', html.escape(part))
                out.append(f'<span style="{";".join(css)}">{t}</span>' if css else t)
            continue
        codes = [int(c) if c else 0 for c in re.split("[;:]", part[2:-1])] or [0]
        i = 0
        while i < len(codes):
            c = codes[i]
            if c == 0: st = {}
            elif c == 1: st["b"] = 1
            elif c == 2: st["d"] = 1
            elif c == 3: st["i"] = 1
            elif c == 4: st["u"] = 1
            elif c == 7: st["rev"] = 1
            elif c == 22: st.pop("b", None); st.pop("d", None)
            elif c == 23: st.pop("i", None)
            elif c == 24: st.pop("u", None)
            elif c == 27: st.pop("rev", None)
            elif 30 <= c <= 37: st["fg"] = BASE16[c - 30]
            elif 90 <= c <= 97: st["fg"] = BASE16[c - 82]
            elif 40 <= c <= 47: st["bg"] = BASE16[c - 40]
            elif 100 <= c <= 107: st["bg"] = BASE16[c - 92]
            elif c == 39: st.pop("fg", None)
            elif c == 49: st.pop("bg", None)
            elif c in (38, 48):
                key = "fg" if c == 38 else "bg"
                if codes[i + 1] == 2:
                    st[key] = "#%02x%02x%02x" % tuple(codes[i + 2:i + 5]); i += 4
                elif codes[i + 1] == 5:
                    st[key] = c256(codes[i + 2]); i += 2
            i += 1
    return "".join(out)


if __name__ == "__main__":
    src, dst, fg, bg = sys.argv[1:5]
    rest = sys.argv[5:]
    strs = [rest[i + 1] for i in range(0, len(rest), 2) if rest[i] == "--mask" and rest[i + 1]]
    # OSC 8 hyperlinks: keep the link text, drop the wrapper.
    text = re.sub(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)", "", open(src, encoding="utf-8").read())
    body = convert(mask(text, strs), fg, bg)
    page = f"""<!doctype html><meta charset="utf-8"><style>
html,body{{margin:0;background:{bg}}}
pre{{margin:0;padding:22px 26px;color:{fg};background:{bg};font:14px/18px 'MesloLGS NF','Adwaita Mono','Noto Sans Math',monospace;display:inline-block}}
pre span{{padding:1px 0}}
pre .c1,pre .c2{{display:inline-block;padding:0}}
pre .c1{{width:1ch}}
pre .c2{{width:2ch}}
</style><pre>{body}</pre>"""
    open(dst, "w", encoding="utf-8").write(page)

