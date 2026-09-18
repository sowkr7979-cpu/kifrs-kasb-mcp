# -*- coding: utf-8 -*-
"""검토의견서 HTML 점검. 사용: python check.py out.html [more.html ...]
보고: 의문형 표현 · 문맥 오인 가능 링크 · SVG 안 HTML 오염 · 미링크 근거 · 남은 자리표시자 · 장별 결론/도해/각주 유무 · 본문 어절 수"""
import re, sys, json, os

LINKS = {}


def check(path):
    s = open(path, encoding="utf-8").read()
    body = re.sub(r"<style>[\s\S]*?</style>", "", s)
    txt = re.sub(r"<[^>]+>", " ", body)
    problems = []
    notes = []
    q = [m.group(0) for m in re.finditer(r"[가-힣]+(?:인가|는가|한가|할까|일까)(?=[\s?.,<)”]|$)", txt)]
    if q: problems.append("의문형 표현: " + ", ".join(q))
    svg_bad = [m.group(0)[:60] for m in re.finditer(r"<svg[\s\S]*?</svg>", s) if re.search(r"<(sup|a|b|span)\b", m.group(0))]
    if svg_bad: problems.append("SVG 안 HTML 태그 %d건" % len(svg_bad))
    left = sorted(set(re.findall(r"\{\{[A-Z_]+\}\}|§", s)))
    if left: problems.append("남은 자리표시자: " + " ".join(left))
    nosvg = re.sub(r"<svg[\s\S]*?</svg>", "", body)
    nosvg = re.sub(r'<div class="fnbox">[\s\S]*?</div></div>', "", nosvg)
    nosvg = re.sub(r"<a [^>]*>[\s\S]*?</a>", "", nosvg)
    plain = re.sub(r"<[^>]+>", " ", nosvg)
    unl = re.findall(r"제\d{4}호(?:\s*문단\s*[0-9A-Z.()]+)?", plain)
    if unl: problems.append("미링크 근거: " + ", ".join(sorted(set(unl))))
    bare = [plain[max(0, m.start() - 14):m.end() + 3].strip() for m in re.finditer(r"(?<![호가-힣])문단\s*\d", plain)]
    if bare:
        # 앵커가 아직 없어 일부러 링크하지 않은 것과, 실수로 빠뜨린 것을 구분한다.
        if LINKS.get("sections"):
            notes.append("미링크 '문단 N' %d건 — kasb-links.json 에 앵커가 없는 문단은 "
                         "링크하지 않는 것이 정상이다(앵커 등록 시 자동 링크됨). 확인: %s"
                         % (len(bare), " | ".join(bare[:6])))
        else:
            problems.append("미링크 '문단 N': " + " | ".join(bare))
    # 문단을 가리키는데 앵커가 없는 링크 = 기준서 최상단(문단 1)으로 떨어진다
    noanchor = {}
    for m in re.finditer(r'<a[^>]*href="https://db\.kasb\.or\.kr/s/(\d{4})(/[A-Za-z0-9]+)?"[^>]*>([\s\S]*?)</a>', s):
        std, anchor, label = m.group(1), m.group(2), re.sub(r"<[^>]+>", "", m.group(3))
        if anchor:
            continue
        paras = re.findall(r"(?:AG|B)?\d+(?:\.\d+)*[A-Z]?(?:\(\d+\))?", re.sub(r"제\d{4}호", "", label))
        for p in paras:
            noanchor.setdefault(std, set()).add(p)
    if noanchor:
        n = sum(len(v) for v in noanchor.values())
        problems.append("문단 앵커 없는 링크 %d종 — 기준서 최상단(문단 1)으로 이동함:\n      "
                        % n + "\n      ".join("제%s호 문단 %s" % (k, ", ".join(sorted(v)))
                                              for k, v in sorted(noanchor.items())))

    # 문맥 추정 링크 목록(사람이 훑어볼 것)
    ctx = []
    for m in re.finditer(r'<a class="ref" href="https://db\.kasb\.or\.kr/s/(\d{4})[^"]*">(문단[^<]*)</a>', s):
        before = re.sub(r"<[^>]+>", "", s[max(0, m.start() - 80):m.start()]).replace("\n", " ")[-40:]
        ctx.append("%s ← %s … %s" % (m.group(2), m.group(1), before))
    # 장별 구성
    secs = re.findall(r'<section class="page">([\s\S]*?)</section>', s)
    weak = []
    for sec in secs:
        h = re.search(r"<h2>(.*?)</h2>", sec)
        if not h or h.group(1).startswith("검토 결과"): continue
        miss = []
        if 'class="concl"' not in sec and 'class="warn"' not in sec: miss.append("결론 박스")
        if "<figure>" not in sec and 'class="steps"' not in sec: miss.append("도해")
        if 'class="fnbox"' not in sec: miss.append("각주")
        if miss: weak.append("%s: %s 없음" % (re.sub(r"<[^>]+>", "", h.group(1))[:20], "·".join(miss)))
    words = len(plain.split())
    print("■", path)
    print("  그림 %d · 표 %d · 분개카드 %d · 타일 %d · 링크 %d · 본문 어절(도해·각주 제외) %d" % (
        s.count("<b>그림 "), s.count("<caption>표 "), s.count('class="je"'), s.count('class="tl'), s.count('class="ref"'), words))
    for p in problems: print("  ✗", p)
    for n in notes: print("  △", n)
    for w in weak: print("  △", w)
    if not problems: print("  ✓ 의문형·SVG 오염·자리표시자·미링크 근거 없음")
    print("  문맥 추정 링크 %d건 (기준서 번호가 맞는지 훑어볼 것):" % len(ctx))
    for c in ctx: print("     ", c)


if __name__ == "__main__":
    lp = next((sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == "--links"), None)
    args = [a for a in sys.argv[1:] if not a.startswith("--") and a != lp]
    if lp and os.path.exists(lp):
        LINKS = json.load(open(lp, encoding="utf-8"))
    for p in args:
        check(p)
