# -*- coding: utf-8 -*-
"""검토의견서 HTML → PDF(Chrome 인쇄 + 쪽머리/쪽밑) → Word(.docx).

사용: python build.py out.html --pdf 결과.pdf [--docx 결과.docx] --footer "의뢰회사 | 문서명 | 회계 검토 의견서" [--logo 경로]
필요: Chrome, PyMuPDF(fitz), pywin32(Word 설치), Pillow 는 불필요.
Word 변환은 SVG 를 Chrome 스크린샷 PNG 로 바꾼 HTML 을 Word COM 으로 열어 .docx 로 저장한다(도해는 그림으로 들어감)."""
import os, sys, re, base64, subprocess, urllib.parse, argparse, tempfile
import fitz

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
HERE = os.path.dirname(os.path.abspath(__file__))
LOGO_DEFAULT = os.path.join(HERE, "..", "assets", "logo.png")  # 없으면 로고를 생략한다
KFONT = r"C:\Windows\Fonts\malgun.ttf"
NAVY, GREEN, GREY = (0.0, 0.082, 0.239), (0.247, 0.612, 0.208), (0.533, 0.545, 0.549)
MM = 72 / 25.4
TMP = tempfile.mkdtemp(prefix="opinion_")
HEAD = ('<!DOCTYPE html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;600;700;800&display=swap">\n')


def chrome(args):
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars"] + args, capture_output=True, timeout=180)


def build_pdf(src_html, out_pdf, footer, logo):
    body = open(src_html, encoding="utf-8").read()
    print_html = os.path.join(TMP, "_print.html")
    open(print_html, "w", encoding="utf-8").write(HEAD + body + "\n</html>\n")
    raw = os.path.join(TMP, "_raw.pdf")
    chrome(["--no-pdf-header-footer", "--virtual-time-budget=20000", f"--print-to-pdf={raw}",
            "file:///" + urllib.parse.quote(print_html.replace("\\", "/"))])
    if not os.path.exists(raw):
        sys.exit("인쇄 실패: " + src_html)
    doc = fitz.open(raw)
    n = doc.page_count
    lw, lh = 26 * MM, 11 * MM
    for i, page in enumerate(doc):
        if i == 0:
            continue
        w, h = page.rect.width, page.rect.height
        page.insert_font(fontname="kr", fontfile=KFONT)
        lx = w - 17 * MM - lw
        if logo and os.path.exists(logo):
            page.insert_image(fitz.Rect(lx, 8 * MM, lx + lw, 8 * MM + lh), filename=logo, keep_proportion=True)
        ry = 8 * MM + lh + 1.6 * MM
        page.draw_line(fitz.Point(17 * MM, ry), fitz.Point(w - 17 * MM, ry), color=NAVY, width=1.5)
        fy = h - 11 * MM
        page.draw_line(fitz.Point(17 * MM, fy), fitz.Point(w - 17 * MM, fy), color=GREEN, width=0.8)
        page.insert_text(fitz.Point(17 * MM, fy + 4.4 * MM), footer, fontsize=6.8, color=GREY, fontname="kr")
        num = f"{i + 1} / {n}"
        tw = fitz.get_text_length(num, fontname="hebo", fontsize=8)
        page.insert_text(fitz.Point(w - 17 * MM - tw, fy + 4.4 * MM), num, fontsize=8, color=NAVY, fontname="hebo")
    doc.save(out_pdf, garbage=4, deflate=True)
    doc.close()
    print(f"PDF 완성: {out_pdf}  쪽수 {n}  {round(os.path.getsize(out_pdf)/1024)} KB")


def svg_to_png(svg, idx):
    m = re.search(r'viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"', svg)
    vw, vh = float(m.group(1)), float(m.group(2))
    W = 720; H = int(vh / vw * W) + 2
    page = (HEAD + "<style>svg text{font-family:'Malgun Gothic','Noto Sans KR',sans-serif} body{margin:0;background:#fff} svg{width:720px;height:auto;display:block}</style>"
            "</head><body>" + svg + "</body></html>")
    p = os.path.join(TMP, f"_fig_{idx}.html"); open(p, "w", encoding="utf-8").write(page)
    png = os.path.join(TMP, f"_fig_{idx}.png")
    chrome([f"--window-size={W},{H}", "--force-device-scale-factor=2", "--virtual-time-budget=8000", f"--screenshot={png}",
            "file:///" + urllib.parse.quote(p.replace("\\", "/"))])
    return png, vw, vh


WORD_CSS = """
    body{font-family:'Malgun Gothic','Noto Sans KR',sans-serif;font-size:10pt;line-height:1.6}
    .cover{height:auto;position:static;page-break-after:always;text-align:center}
    .cover .mid,.cover .firm,.cover .disc{position:static;text-align:center;margin-top:24pt}
    .cover .disc{text-align:justify;font-size:8pt}
    .page{page-break-before:always}
    table{border-collapse:collapse;width:100%} th,td{border:0.7pt solid #CDCECF;padding:3pt 4pt;font-size:9pt} th{background:#F0F0F0;color:#00153D}
    .concl{border:1.4pt solid #3F9C35;background:#F4FAF3;padding:6pt 8pt;margin:0 0 8pt}
    .warn{border:1.4pt solid #C0392B;background:#FDF3F2;padding:6pt 8pt;margin:6pt 0}
    .note{border-left:3pt solid #009CDE;background:#EAF4FB;padding:6pt 8pt;margin:6pt 0}
    .tag{background:#3F9C35;color:#fff;font-weight:bold;padding:1pt 5pt;font-size:8pt} .warn .tag{background:#C0392B}
    .fnbox{border-top:0.7pt solid #B8B8B9;margin-top:8pt;padding-top:4pt;font-size:8pt;color:#515356}
    .je{border:0.7pt solid #CDCECF;margin:4pt 0} .je .jh{background:#F0F0F0;font-weight:bold;color:#00153D;padding:3pt 5pt;font-size:8.6pt}
    .je td{border:none;border-top:0.5pt solid #CDCECF;width:50%;font-size:8.8pt} .je .why{font-size:8pt;color:#515356;padding:2pt 5pt}
    .dc{color:#888B8D;font-size:7.8pt} .amt{font-weight:bold;color:#00153D}
    .tiles3 .tl,.steps .st{border:0.7pt solid #CDCECF;padding:4pt;margin:3pt 0;font-size:8.8pt}
    figcaption{font-size:8.6pt;color:#888B8D} h2{color:#00153D;border-bottom:2pt solid #3F9C35;font-size:14pt} h3{color:#00153D;font-size:11.4pt}
    sup.fn{color:#3F9C35;font-weight:bold;font-size:7pt} a{color:#1F5FA8;text-decoration:none} .sign{text-align:center;margin-top:24pt}
"""


def build_docx(src_html, out_docx):
    import win32com.client as w, pythoncom
    # Word 의 SaveAs2 는 상대 경로를 Word 자신의 기본 폴더 기준으로 푸므로 절대 경로를 넘긴다.
    out_docx = os.path.abspath(out_docx)
    body = open(src_html, encoding="utf-8").read()
    for i, svg in enumerate(re.findall(r"<svg[\s\S]*?</svg>", body)):
        png, vw, vh = svg_to_png(svg, i)
        b64 = base64.b64encode(open(png, "rb").read()).decode()
        body = body.replace(svg, f'<img src="data:image/png;base64,{b64}" width="640" height="{int(vh / vw * 640)}" alt="그림">', 1)
    body = body.replace("<style>", "<style>" + WORD_CSS, 1)
    p = os.path.join(TMP, "_word.html"); open(p, "w", encoding="utf-8").write(HEAD + body + "\n</html>\n")
    pythoncom.CoInitialize()
    app = w.Dispatch("Word.Application"); app.Visible = False; app.DisplayAlerts = 0
    try:
        tmp_out = out_docx + ".new.docx"
        if os.path.exists(tmp_out): os.remove(tmp_out)
        doc = app.Documents.Open(p, ConfirmConversions=False, ReadOnly=True, Format=8)
        doc.SaveAs2(tmp_out, FileFormat=16)
        pages = doc.ComputeStatistics(2); doc.Close(False)
    finally:
        app.Quit()
    if not os.path.exists(tmp_out):
        sys.exit("Word 저장 실패 — 기존 파일은 그대로 두었다: " + out_docx)
    os.replace(tmp_out, out_docx)
    print(f"Word 완성: {out_docx}  쪽수 {pages}  {round(os.path.getsize(out_docx)/1024)} KB")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("--pdf"); ap.add_argument("--docx")
    ap.add_argument("--footer", default="○○○ 주식회사  |  회계 검토 의견서")
    ap.add_argument("--logo", default=LOGO_DEFAULT)
    a = ap.parse_args()
    if a.pdf: build_pdf(a.src, a.pdf, a.footer, a.logo)
    if a.docx: build_docx(a.src, a.docx)
