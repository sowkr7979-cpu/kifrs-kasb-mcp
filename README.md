# 회계기준 MCP 서버와 검토의견서 빌드 도구

| 폴더 | 내용 |
|---|---|
| `kifrs-mcp/` | [kifrs.com](https://www.kifrs.com) MCP 서버. K-IFRS 기준서 목록·전문 검색·목차·문단 본문, 질의회신 검색·조회. 로그인 선택 |
| `kasb-mcp/` | [kasb.or.kr](https://www.kasb.or.kr) MCP 서버. 한국회계기준원 통합검색·게시판 목록·상세 본문. 로그인 불필요 |
| `검토의견서/` | 회계 검토 의견서 HTML 템플릿, 각주·링크 후처리, 점검, PDF·Word 빌드 스크립트 |
| `templates/` | 보고용 요약 양식 |

## 설치

```
cd kifrs-mcp && npm install
cd ../kasb-mcp && npm install
```

`.mcp.json.example` 을 `.mcp.json` 으로 복사하면 이 폴더에서 Claude Code 를 실행할 때 두 서버가 등록된다.
kifrs.com 회원 기능이 필요하면 `kifrs-mcp/.env.example` 을 `kifrs-mcp/.env` 로 복사해 계정을 입력한다. `.env` 는 커밋되지 않는다.

## 주의

- 두 서버는 각 사이트의 내부 API 또는 공개 화면을 감싼 것이라 사이트 개편 시 동작이 바뀔 수 있다.
- 개인 업무 보조 용도로만 사용한다. 대량 수집·재배포는 금지한다. 기준서 원문 저작권은 한국회계기준원에 있다.
- `db.kasb.or.kr` 는 robots.txt 가 전체 차단이므로 kasb-mcp 는 접근하지 않는다.
