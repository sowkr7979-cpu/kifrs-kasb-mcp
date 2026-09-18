# kifrs-mcp

[kifrs.com](https://www.kifrs.com)(K-IFRS 회계기준 서비스)을 감싼 MCP 서버.
Claude가 대화 중에 K-IFRS 기준서와 질의회신을 직접 검색·조회할 수 있게 해준다.

## 제공 도구

| 도구 | 설명 |
|---|---|
| `list_standards` | K-IFRS 기준서 번호·제목 목록 |
| `search_standards` | 키워드로 기준서 전문 검색 (기준서별 매칭 건수) |
| `get_standard_toc` | 기준서 목차 (섹션 제목 + 문단 범위) |
| `get_paragraphs` | 문단 본문 조회 — `'22'`, `'5~8'`, `'B3~B8'` 형식 지원 |
| `search_qnas` | 금감원/회계기준원/IFRS 해석위 질의회신 검색 |
| `get_qna` | 질의회신 상세 조회 |

검색·목차·문단·질의회신 조회는 **로그인 없이 동작한다.**

## 설치

```
cd kifrs-mcp
npm install
```

## 로그인 (선택)

회원 전용 기능이 필요하면 `.env.example`을 `.env`로 복사하고 본인 계정을 입력:

```
KIFRS_EMAIL=본인이메일
KIFRS_PASSWORD=비밀번호
```

`.env`는 `.gitignore`에 포함되어 있어 커밋되지 않는다. **절대 공유 금지.**

## Claude Code에 등록

프로젝트 루트의 `.mcp.json`이 이미 등록해준다 (이 폴더에서 Claude Code 실행 시 자동 인식).

다른 위치에서도 쓰려면 사용자 전역으로 등록:

```
claude mcp add --scope user kifrs -- node "<프로젝트 경로>\kifrs-mcp\index.js"
```

Claude Desktop에서 쓰려면 `claude_desktop_config.json`에 추가:

```json
{
  "mcpServers": {
    "kifrs": {
      "command": "node",
      "args": ["<프로젝트 경로>\\kifrs-mcp\\index.js"]
    }
  }
}
```

## 사용 예

Claude에게 그냥 물어보면 된다:

> "리스 인식 면제 조건이 뭐야?"
> → `search_standards("인식 면제")` → `get_paragraphs(1116, "5~8")` → 근거 문단과 함께 답변

## 주의사항

- kifrs.com의 비공개 내부 API를 사용하므로 사이트 개편 시 동작이 바뀔 수 있다.
- 본인 개인 업무 보조 용도로만 사용할 것. 대량 수집·재배포 금지 (K-IFRS 원문 저작권: 한국회계기준원).
