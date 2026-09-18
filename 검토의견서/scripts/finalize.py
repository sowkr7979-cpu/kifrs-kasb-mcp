# -*- coding: utf-8 -*-
"""검토의견서 HTML 후처리: 그림·표 번호, 각주 번호·본문, 근거 규정 하이퍼링크, 장 참조 자리표시자.

사용:  python finalize.py in.html out.html --footnotes footnotes.json [--links kasb-links.json] [--ch CH_VI=Ⅵ장 ...]

입력 규약
  <b>그림 §.</b> / <caption>표 §.       → 문서 순서대로 번호
  <sup class="fn" data-fn="KEY"></sup>   → N) 각주 표시 (같은 KEY 는 같은 번호)
  <div class="fnbox" data-fns="K1,K2"></div> → 각주 본문 (footnotes.json: {KEY:{url,title,excerpt}})
  {{CH_XXX}}                             → --ch 로 준 값으로 치환
"""
import re, sys, json, argparse, html as _h

PARA = r"[0-9A-Z][0-9A-Z.()㈎㈏]*"
RE_STD = re.compile(r"제(\d{4})호(\s*문단\s*" + PARA + r"(?:\s*[·~→,]\s*" + PARA + r")*)?")
RE_BARE = re.compile(r"(?<![호가-힣])문단\s*(" + PARA + r")(?:\s*[·~→,]\s*" + PARA + r")*")


def load_deep(path):
    deep = {}
    if not path:
        return deep
    j = json.load(open(path, encoding="utf-8"))
    for std, secs in j.get("sections", {}).items():
        for _sid, info in secs.items():
            paras = str(info.get("문단", ""))
            for p in re.split(r"[~·,\s]+", paras):
                if p:
                    deep[(std, p)] = info["url"]
            m = re.match(r"(\d+)\s*~\s*(\d+)$", paras)
            if m:
                for n in range(int(m.group(1)), int(m.group(2)) + 1):
                    deep[(std, str(n))] = info["url"]
    return deep


def make_url(deep, std, para_text):
    first = re.search(r"\d+[A-Z]?", para_text or "")
    key = (std, first.group(0)) if first else None
    return deep.get(key, "https://db.kasb.or.kr/s/" + std)


def linkify(doc, deep):
    tokens = re.split(r"(<[^>]+>)", doc)
    out, depth_a, depth_svg, skip, last_std = [], 0, 0, 0, None
    for t in tokens:
        if t.startswith("<"):
            tl = t.lower()
            if tl.startswith("<a "): depth_a += 1
            elif tl.startswith("</a"): depth_a -= 1
            elif tl.startswith("<svg"): depth_svg += 1
            elif tl.startswith("</svg"): depth_svg -= 1
            elif tl.startswith("<style") or tl.startswith("<title"): skip += 1
            elif tl.startswith("</style") or tl.startswith("</title"): skip -= 1
            m = re.search(r"db\.kasb\.or\.kr/s/(\d{4})", t)
            if m: last_std = m.group(1)
            out.append(t); continue
        if depth_a or depth_svg or skip or not t.strip():
            out.append(t); continue

        # '제○○호' 등장 순서대로 처리해, 그 앞의 '문단 N' 은 이전 문맥의 기준서를, 뒤의 것은 새 기준서를 가리키게 한다
        def bare(seg, std):
            if not std: return seg
            return RE_BARE.sub(lambda m: '<a class="ref" href="%s">%s</a>' % (make_url(deep, std, m.group(1)), m.group(0)), seg)
        pieces, pos = [], 0
        for m in RE_STD.finditer(t):
            pieces.append(bare(t[pos:m.start()], last_std))
            last_std = m.group(1)
            pieces.append('<a class="ref" href="%s">%s</a>' % (make_url(deep, m.group(1), m.group(2)), m.group(0)))
            pos = m.end()
        pieces.append(bare(t[pos:], last_std))
        out.append("".join(pieces))
    return "".join(out)


def finalize(doc, fn, deep, ch):
    for k, v in ch.items():
        doc = doc.replace("{{" + k + "}}", v)
    n = [0]
    doc = re.sub(r"<b>그림 (?:\d+|§)\.</b>", lambda m: (n.__setitem__(0, n[0] + 1) or "<b>그림 %d.</b>" % n[0]), doc)
    t = [0]
    doc = re.sub(r"<caption>표 (?:\d+|§)\.", lambda m: (t.__setitem__(0, t[0] + 1) or "<caption>표 %d." % t[0]), doc)
    order, num = [], {}

    def sup(m):
        k = m.group(1)
        if k not in num:
            order.append(k); num[k] = len(order)
        return '<sup class="fn" id="fnref-%s-%d">%d)</sup>' % (k, num[k], num[k])
    doc = re.sub(r'<sup class="fn" data-fn="([^"]+)"></sup>', sup, doc)
    doc = linkify(doc, deep)

    def box(m):
        rows = []
        for k in [k for k in m.group(1).split(",") if k]:
            if k not in num:
                order.append(k); num[k] = len(order)
            e = fn[k]
            rows.append('<div><b>%d)</b> <a class="ref" href="%s">%s</a> — %s</div>' % (num[k], _h.escape(e["url"], quote=True), e["title"], e["excerpt"]))
        return '<div class="fnbox">' + "".join(rows) + "</div>"
    doc = re.sub(r'<div class="fnbox" data-fns="([^"]*)"></div>', box, doc)
    left = re.findall(r"\{\{[A-Z_]+\}\}", doc)
    if left:
        sys.exit("치환되지 않은 자리표시자: " + ", ".join(sorted(set(left))))
    if "§" in doc:
        sys.exit("번호가 매겨지지 않은 § 가 남아 있습니다")
    return doc


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("out")
    ap.add_argument("--footnotes", required=True)
    ap.add_argument("--links", default=None)
    ap.add_argument("--ch", nargs="*", default=[], help="CH_VI=Ⅵ장 형식")
    a = ap.parse_args()
    fn = json.load(open(a.footnotes, encoding="utf-8"))
    ch = dict(x.split("=", 1) for x in a.ch)
    doc = open(a.src, encoding="utf-8").read()
    out = finalize(doc, fn, load_deep(a.links), ch)
    open(a.out, "w", encoding="utf-8").write(out)
    print("완료:", a.out, "| 그림", out.count("<b>그림 "), "| 표", out.count("<caption>표 "), "| 링크", out.count('class="ref"'))
