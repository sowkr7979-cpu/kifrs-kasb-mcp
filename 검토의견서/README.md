# 검토의견서 빌드 도구

HTML 로 쓴 회계 검토 의견서를 후처리하고 PDF·Word 로 만든다.

```
python scripts/finalize.py in.html out.html --footnotes footnotes.json [--links kasb-links.json] [--ch CH_VI=Ⅵ장 ...]
python scripts/check.py out.html [--links kasb-links.json]
python scripts/build.py out.html --pdf 결과.pdf [--docx 결과.docx] --footer "의뢰회사 | 제목 | 회계 검토 의견서" [--logo assets/logo.png]
python scripts/relink.py kasb-links.json a.html b.html ...
```

| 파일 | 역할 |
|---|---|
| `templates/report_template.html` | 전체 CSS + 표지 + 요약 뼈대 + 서명. `{{TITLE}}` `{{CLIENT}}` `{{FIRM_KR}}` `{{FIRM_EN}}` `{{YEAR}}` `{{LOGO_DATA_URI}}` `{{DATE}}` `{{SUMMARY}}` `{{CHAPTERS}}` `{{LAST_CHAPTER}}` 등을 채운다 |
| `templates/components.html` | 결론·주의·참고 박스, 표, 그림, 분개 카드, 단계 체인, 타일, 각주 표시 스니펫 |
| `scripts/finalize.py` | 그림·표 번호 매김, `<sup class="fn" data-fn="KEY">` 각주 번호·본문 채움, `제○○○○호 문단 N` 자동 링크, `{{CH_XXX}}` 치환 |
| `scripts/check.py` | 의문형 표현, 남은 자리표시자, SVG 안 HTML 태그, 미링크 근거, 문단 앵커 없는 링크를 보고 |
| `scripts/build.py` | Chrome 인쇄 → 쪽머리(로고·남색선)·쪽밑(초록선·문서명·쪽번호) 삽입 → PDF. `--docx` 는 SVG 를 PNG 로 바꿔 Word COM 으로 저장 |
| `scripts/relink.py` | `kasb-links.json` 의 앵커에 맞춰 db.kasb 링크를 딥링크·기준서 링크·평문으로 재배분 |
| `references/footnotes.example.json` | 각주 사전 예시 `{KEY: {url, title, excerpt}}` |
| `references/kasb-links.example.json` | 링크 규칙과 문단 딥링크 예시 |
| `assets/` | `logo.png` 를 두면 쪽머리에 들어간다. 없으면 로고 없이 빌드된다 |

필요: Chrome, PyMuPDF. Word 변환은 pywin32 와 Microsoft Word.
