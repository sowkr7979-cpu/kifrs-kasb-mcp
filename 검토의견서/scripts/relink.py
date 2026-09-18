# -*- coding: utf-8 -*-
"""db.kasb 링크를 kasb-links.json 의 앵커 재고에 맞춰 다시 건다.
  앵커 있음  -> <a href=/s/1032/IKM5uH>제1032호 문단 11</a>      (문단까지 바로 감)
  앵커 없음  -> <a href=/s/1110>제1110호</a> 문단 23             (기준서까지만, 문구 정직)
  문단만 있고 앵커 없음 -> 링크 해제(평문)
여러 문단을 한 링크로 묶은 문구는 앵커를 걸지 않는다(어느 문단으로 보낼지 정할 수 없으므로)."""
import re, sys, json

A = re.compile(r'<a([^>]*?)href="https://db\.kasb\.or\.kr/s/(\d{4})(?:/[A-Za-z0-9]+)?"([^>]*?)>([\s\S]*?)</a>')
SPLIT = re.compile(r'^(\s*(?:기준서|해석서)?\s*제\d{4}호)(\s*문단[\s\S]*)$')
TOKEN = re.compile(r'(?:AG|B)?\d+(?:\.\d+)*[A-Z]?(?:\(\d+\))?')

def base(p):                       # 16(1) -> 16, 12(8) -> 12
    return re.sub(r'\(\d+\)$', '', p)

def load(path):
    d = json.load(open(path, encoding="utf-8"))
    idx = {}
    for std, secs in d.get("sections", {}).items():
        for sid, meta in secs.items():
            for part in re.split(r'[~·,]', str(meta["문단"])):
                part = part.strip()
                if part:
                    idx[(std, part)] = meta["url"]
    return idx

def run(path, idx):
    src = open(path, encoding="utf-8").read()
    st = {"딥링크": 0, "문단 분리": 0, "링크 해제": 0, "유지": 0}
    def repl(m):
        pre, std, post, inner = m.groups()
        plain = re.sub(r"<[^>]+>", "", inner).strip()
        # 기준서명만 가리키는 링크는 그대로
        if re.match(r"^\s*(?:기준서|해석서)?\s*제\d{4}호[가-힣:\s]*$", plain) or not re.search(r"문단|\d|^[AGB]", plain):
            st["유지"] += 1
            return f'<a{pre}href="https://db.kasb.or.kr/s/{std}"{post}>{inner}</a>'
        paras = {base(t) for t in TOKEN.findall(re.sub(r"제\d{4}호", "", plain))}
        # 문구 안의 문단이 모두 같은 절(같은 앵커)로 모이면 그 앵커를 건다.
        urls = {idx.get((std, p)) for p in paras} if paras else {None}
        if len(urls) == 1 and None not in urls:
            st["딥링크"] += 1
            return f'<a{pre}href="{urls.pop()}"{post}>{inner}</a>'
        # 여러 문단이 각기 다른 절이면, 문단 번호마다 자기 절로 따로 건다.
        if len(paras) > 1 and all(idx.get((std, p)) for p in paras):
            def wrap(mm):
                u = idx.get((std, base(mm.group(0))))
                return f'<a{pre}href="{u}"{post}>{mm.group(0)}</a>' if u else mm.group(0)
            s2 = SPLIT.match(inner)
            head, tail = (s2.group(1), s2.group(2)) if s2 else ("", inner)
            tail = TOKEN.sub(wrap, tail)
            st["개별 딥링크"] = st.get("개별 딥링크", 0) + 1
            if head:
                return f'<a{pre}href="https://db.kasb.or.kr/s/{std}"{post}>{head}</a>{tail}'
            return tail
        s = SPLIT.match(inner)
        if s:                                         # 제NNNN호만 남기고 문단은 밖으로
            st["문단 분리"] += 1
            return f'<a{pre}href="https://db.kasb.or.kr/s/{std}"{post}>{s.group(1)}</a>{s.group(2)}'
        if re.match(r"^\s*(?:문단\s*)?(?:AG|B)?[0-9]", plain):
            st["링크 해제"] += 1
            return inner
        st["유지"] += 1
        return f'<a{pre}href="https://db.kasb.or.kr/s/{std}"{post}>{inner}</a>'
    out = A.sub(repl, src)
    open(path, "w", encoding="utf-8").write(out)
    print("■ %s\n   딥링크 %d · 문단 분리 %d · 링크 해제 %d · 유지 %d"
          % (path.split("/")[-1], st["딥링크"], st["문단 분리"], st["링크 해제"], st["유지"]))

if __name__ == "__main__":
    idx = load(sys.argv[1])
    print("앵커 재고 %d개\n" % len(idx))
    for p in sys.argv[2:]:
        run(p, idx)
