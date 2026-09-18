#!/usr/bin/env node
/**
 * kifrs-mcp — kifrs.com을 감싸는 MCP 서버
 *
 * kifrs.com의 내부 REST API(/api/*)를 MCP 도구로 노출한다.
 * 검색·목차·문단 조회는 비로그인으로 동작하며,
 * KIFRS_EMAIL / KIFRS_PASSWORD 환경변수가 있으면 로그인 세션을 사용한다.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// 스크립트 옆의 .env 파일을 읽어 환경변수로 로드 (이미 설정된 값은 유지)
try {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), ".env");
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {
  /* .env 없으면 비로그인 모드 */
}

const BASE = "https://www.kifrs.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) kifrs-mcp/0.1 (personal use)";

// ---------------------------------------------------------------------------
// 인증 (선택): 로그인하면 세션 쿠키를 이후 요청에 첨부한다
// ---------------------------------------------------------------------------
let cookieHeader = "";

async function login() {
  const email = process.env.KIFRS_EMAIL;
  const password = process.env.KIFRS_PASSWORD;
  if (!email || !password) return;

  try {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ email, password }),
    });
    const cookies = res.headers.getSetCookie?.() ?? [];
    const jar = cookies.map((c) => c.split(";")[0]);

    const body = await res.json().catch(() => ({}));
    // 서버가 쿠키 대신 본문으로 토큰을 주는 경우도 커버
    for (const key of ["token", "authToken", "accessToken"]) {
      if (typeof body[key] === "string" && !jar.some((c) => c.startsWith("authToken="))) {
        jar.push(`authToken=${body[key]}`);
      }
    }
    if (jar.length > 0) {
      cookieHeader = jar.join("; ");
      console.error(`[kifrs-mcp] 로그인 성공 (${email})`);
    } else {
      console.error(
        `[kifrs-mcp] 로그인 응답에 세션 정보가 없습니다 (status ${res.status}): ${JSON.stringify(body).slice(0, 200)}`
      );
    }
  } catch (e) {
    console.error(`[kifrs-mcp] 로그인 실패: ${e.message} — 비로그인 모드로 계속`);
  }
}

async function api(path, params) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const headers = { "User-Agent": UA, Accept: "application/json" };
  if (cookieHeader) headers.Cookie = cookieHeader;

  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`kifrs.com API 오류 ${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`JSON이 아닌 응답: ${text.slice(0, 200)}`);
  }
}

const stripHtml = (html) =>
  (html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const parseJsonArray = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.startsWith("[")) {
    try {
      return JSON.parse(v);
    } catch {
      /* fallthrough */
    }
  }
  return v ? [String(v)] : [];
};

// ---------------------------------------------------------------------------
// K-IFRS 기준서 카탈로그 (번호 → 제목)
// ---------------------------------------------------------------------------
const CATALOG = {
  1001: "재무제표 표시",
  1002: "재고자산",
  1007: "현금흐름표",
  1008: "회계정책, 회계추정치 변경과 오류",
  1010: "보고기간후사건",
  1012: "법인세",
  1016: "유형자산",
  1019: "종업원급여",
  1020: "정부보조금의 회계처리와 정부지원의 공시",
  1021: "환율변동효과",
  1023: "차입원가",
  1024: "특수관계자 공시",
  1026: "퇴직급여제도에 의한 회계처리와 보고",
  1027: "별도재무제표",
  1028: "관계기업과 공동기업에 대한 투자",
  1029: "초인플레이션 경제에서의 재무보고",
  1032: "금융상품: 표시",
  1033: "주당이익",
  1034: "중간재무보고",
  1036: "자산손상",
  1037: "충당부채, 우발부채, 우발자산",
  1038: "무형자산",
  1040: "투자부동산",
  1041: "농림어업",
  1101: "한국채택국제회계기준의 최초채택",
  1102: "주식기준보상",
  1103: "사업결합",
  1104: "보험계약(구)",
  1105: "매각예정비유동자산과 중단영업",
  1106: "광물자원의 탐사와 평가",
  1107: "금융상품: 공시",
  1108: "영업부문",
  1109: "금융상품",
  1110: "연결재무제표",
  1111: "공동약정",
  1112: "타 기업에 대한 지분의 공시",
  1113: "공정가치 측정",
  1114: "규제이연계정",
  1115: "고객과의 계약에서 생기는 수익",
  1116: "리스",
  1117: "보험계약",
  1118: "재무제표 표시와 공시(신)",
  2029: "해석서: 초인플레이션 경제에서의 재무보고",
  2032: "해석서: 무형자산 - 웹사이트 원가",
  2101: "해석서: 사후처리 및 복구관련 충당부채의 변동",
  2102: "해석서: 주식기준보상 - 자기주식 및 연결실체주식 거래",
  2104: "해석서: 약정에 리스가 포함되어 있는지의 결정",
  2105: "해석서: 사후처리·복구·환경정화 기금의 지분에 대한 권리",
  2106: "해석서: 특정 시장에 참여함에 따라 발생하는 부채 - 폐전기·전자제품",
  2107: "해석서: K-IFRS 제1029호의 최초 적용",
  2110: "해석서: 중간재무보고와 손상",
  2112: "해석서: 민간투자사업",
  2114: "해석서: 확정급여자산한도, 최소적립요구액과 그 상호관용",
  2116: "해석서: 해외사업장순투자의 위험회피",
  2119: "해석서: 지분상품에 의한 금융부채의 소멸",
  2120: "해석서: 노천광산 생산단계의 박토원가",
  2121: "해석서: 부담금",
  2122: "해석서: 외화 거래와 선지급·선수취 대가",
  2123: "해석서: 법인세 처리의 불확실성",
  // 내부회계관리제도 관련 (내부회계관리제도운영위원회 제정)
  3002: "내부회계관리제도 설계 및 운영 개념체계",
  3003: "내부회계관리제도 평가 및 보고 모범규준",
  3004: "내부회계관리제도 설계 및 운영 적용기법",
  3005: "내부회계관리제도 평가 및 보고 적용기법",
  3006: "내부회계관리제도 설계 및 운영 적용기법(중소기업)",
  3007: "내부회계관리제도 평가 및 보고 적용기법(중소기업)",
  // 회계감사기준 (주요)
  200: "회계감사기준 200 독립된 감사인의 전반적인 목적",
  240: "회계감사기준 240 부정에 관한 감사인의 책임",
  265: "회계감사기준 265 내부통제 미비점 커뮤니케이션",
  315: "회계감사기준 315 중요왜곡표시위험의 식별과 평가",
  330: "회계감사기준 330 평가된 위험에 대한 감사인의 대응",
  550: "회계감사기준 550 특수관계자",
  600: "회계감사기준 600 그룹재무제표 감사",
  610: "회계감사기준 610 내부감사인이 수행한 업무의 활용",
  1100: "회계감사기준 1100 내부회계관리제도의 감사",
  1200: "회계감사기준 1200 내부회계관리제도의 검토",
};

// ---------------------------------------------------------------------------
// MCP 서버 정의
// ---------------------------------------------------------------------------
const server = new McpServer({ name: "kifrs", version: "0.1.0" });

server.registerTool(
  "list_standards",
  {
    title: "K-IFRS 기준서 목록",
    description:
      "K-IFRS 기준서 번호와 제목 목록을 반환한다. stdNum이 필요한 다른 도구를 쓰기 전에 참고용으로 사용.",
    inputSchema: {},
  },
  async () => {
    const lines = Object.entries(CATALOG).map(
      ([num, title]) => `${num}: ${title}`
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

server.registerTool(
  "search_standards",
  {
    title: "기준서 전문 검색",
    description:
      "키워드로 K-IFRS 기준서 전체를 검색해 기준서별 매칭 건수를 반환한다. " +
      "결과를 보고 get_standard_toc / get_paragraphs로 내용을 조회하면 된다.",
    inputSchema: {
      searchWord: z.string().describe("검색어 (한국어)"),
    },
  },
  async ({ searchWord }) => {
    const data = await api("/api/standard", { searchWord });
    const arr = data?.standards?.stdCountArr ?? [];
    const total = data?.standards?.totalCount ?? 0;
    if (arr.length === 0) {
      return { content: [{ type: "text", text: `"${searchWord}" 검색 결과 없음` }] };
    }
    const sorted = [...arr].sort((a, b) => b.doc_count - a.doc_count);
    const lines = sorted.map((s) => {
      const title = CATALOG[s.key] ? ` ${CATALOG[s.key]}` : "";
      return `제${s.key}호${title}: ${s.doc_count}건`;
    });
    return {
      content: [
        {
          type: "text",
          text: `"${searchWord}" 총 ${total}건 매칭\n\n${lines.join("\n")}`,
        },
      ],
    };
  }
);

server.registerTool(
  "get_standard_toc",
  {
    title: "기준서 목차 조회",
    description:
      "특정 기준서의 목차(섹션 제목과 문단 번호 범위)를 반환한다. " +
      "여기서 확인한 문단 범위(ref)를 get_paragraphs에 넘겨 본문을 조회한다.",
    inputSchema: {
      stdNum: z.number().int().describe("기준서 번호 (예: 1116)"),
    },
  },
  async ({ stdNum }) => {
    let data;
    try {
      data = await api(`/api/title/${stdNum}`);
    } catch (e) {
      // kifrs.com은 검색 색인에는 있으나 본문이 등록되지 않은 번호(예: 3101, 3201, 8509, 9401)에
      // 대해 500을 반환한다(2026-09 확인). 서버 측 데이터 누락이므로 안내 메시지로 대체한다.
      return {
        content: [
          {
            type: "text",
            text:
              `제${stdNum}호 목차를 kifrs.com에서 제공하지 않습니다 (서버 응답: ${e.message}).
` +
              `검색 색인에만 존재하고 본문이 등록되지 않은 번호일 수 있습니다. ` +
              `내부회계관리제도 관련 문서는 제3002호~제3007호를, 회계감사기준은 해당 기준서 번호(예: 315, 240, 265)를 사용하세요.`,
          },
        ],
      };
    }
    const titles = data?.titles ?? [];
    if (titles.length === 0) {
      return {
        content: [{ type: "text", text: `제${stdNum}호 목차를 찾을 수 없습니다.` }],
      };
    }
    const name = CATALOG[stdNum] ? ` ${CATALOG[stdNum]}` : "";
    const lines = titles.map((t) => {
      const indent = t.type === "mid" ? "  " : t.type === "small" ? "    " : "";
      const ref = t.ref ? ` [문단 ${t.ref}]` : "";
      return `${indent}${(t.title ?? "").trim()}${ref}`;
    });
    return {
      content: [
        { type: "text", text: `기업회계기준서 제${stdNum}호${name} 목차\n\n${lines.join("\n")}` },
      ],
    };
  }
);

server.registerTool(
  "get_paragraphs",
  {
    title: "기준서 문단 본문 조회",
    description:
      "기준서의 특정 문단(들)의 본문을 반환한다. paraRef는 단일 문단('22'), " +
      "범위('5~8'), 부록 문단('B3~B8', '한2.1') 형식을 지원한다.",
    inputSchema: {
      stdNum: z.number().int().describe("기준서 번호 (예: 1116)"),
      paraRef: z
        .string()
        .describe("문단 번호 또는 범위 (예: '22', '5~8', 'B3~B8')"),
    },
  },
  async ({ stdNum, paraRef }) => {
    let data;
    try {
      data = await api(
        `/api/paragraphs/content/${stdNum}/${encodeURIComponent(paraRef)}`
      );
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: `제${stdNum}호 문단 ${paraRef} 조회 실패 (kifrs.com 서버 응답: ${e.message}). 잠시 후 재시도하거나 다른 번호를 사용하세요.`,
          },
        ],
      };
    }
    const paras = data?.paraContents ?? [];
    if (paras.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `제${stdNum}호 문단 ${paraRef}을(를) 찾을 수 없습니다. 문단 번호 형식을 확인하세요 (예: '5~8', 'B3').`,
          },
        ],
      };
    }
    const blocks = paras.map((p) => {
      const body = p.fullContent?.trim() || stripHtml(p.paraContent);
      return `문단 ${p.paraNum}\n${body}`;
    });
    const name = CATALOG[stdNum] ? ` ${CATALOG[stdNum]}` : "";
    return {
      content: [
        {
          type: "text",
          text: `기업회계기준서 제${stdNum}호${name}\n\n${blocks.join("\n\n---\n\n")}`,
        },
      ],
    };
  }
);

// kifrs.com의 서버측 searchWord 처리가 500을 반환하는 장애가 있어(2026-08 확인),
// 전체 목록(파라미터 없는 /api/qnas는 전건 반환)을 캐시한 뒤 로컬에서 검색한다.
let qnaCache = { list: null, ts: 0 };
const QNA_CACHE_TTL = 10 * 60 * 1000;

async function fetchAllQnas() {
  if (qnaCache.list && Date.now() - qnaCache.ts < QNA_CACHE_TTL) return qnaCache.list;
  const data = await api("/api/qnas");
  const list = (data?.qnas ?? []).filter((q) => q.delYn !== "Y");
  if (list.length > 0) qnaCache = { list, ts: Date.now() };
  return list;
}

const qnaHaystack = (q) =>
  [q.title, q.relStds, q.docNumber, q.searchContent, q.content, q.nows, q.question, q.answer, q.reason]
    .map((v) => (typeof v === "string" ? v : JSON.stringify(v ?? "")))
    .join(" ")
    .toLowerCase();

server.registerTool(
  "search_qnas",
  {
    title: "질의회신 검색",
    description:
      "금융감독원·회계기준원·IFRS 해석위원회 질의회신(Q&A) 요약을 검색한다. " +
      "stdNum으로 특정 기준서 관련 질의회신만 필터링할 수 있다. " +
      "복수 단어는 공백으로 구분하면 AND 조건으로 검색된다.",
    inputSchema: {
      searchWord: z.string().optional().describe("검색어 (공백 구분 시 AND)"),
      stdNum: z.number().int().optional().describe("기준서 번호 필터 (예: 1116, 일반기업회계기준 장 번호도 가능)"),
      page: z.number().int().optional().default(1).describe("페이지 (기본 1, 페이지당 20건)"),
    },
  },
  async ({ searchWord, stdNum, page }) => {
    const all = await fetchAllQnas();
    let hits = all;
    if (stdNum) hits = hits.filter((q) => (q.relStds ?? "").includes(String(stdNum)));
    if (searchWord) {
      const terms = searchWord.toLowerCase().split(/\s+/).filter(Boolean);
      hits = hits.filter((q) => {
        const h = qnaHaystack(q);
        return terms.every((t) => h.includes(t));
      });
    }
    if (hits.length === 0) {
      return { content: [{ type: "text", text: "질의회신 검색 결과 없음" }] };
    }
    const PER = 20;
    const p = Math.max(1, page ?? 1);
    const pageHits = hits.slice((p - 1) * PER, p * PER);
    const lines = pageHits.map(
      (q) =>
        `#${q.id} [${q.date ?? "-"}] ${q.title}` +
        (q.relStds ? ` (관련: ${q.relStds})` : "")
    );
    return {
      content: [
        {
          type: "text",
          text:
            `질의회신 검색 결과 총 ${hits.length}건 (page ${p}/${Math.ceil(hits.length / PER)})\n\n` +
            `${lines.join("\n")}\n\n상세 내용은 get_qna(id)로 조회`,
        },
      ],
    };
  }
);

server.registerTool(
  "get_qna",
  {
    title: "질의회신 상세 조회",
    description: "질의회신 1건의 전체 내용(질의·회신·근거)을 반환한다.",
    inputSchema: {
      id: z.number().int().describe("search_qnas가 반환한 질의회신 id"),
    },
  },
  async ({ id }) => {
    let q;
    try {
      const data = await api(`/api/qnas/${id}`);
      q = data?.qna;
    } catch {
      /* 상세 API 장애 시 목록 캐시에서 폴백 */
    }
    if (!q) {
      const all = await fetchAllQnas().catch(() => []);
      q = all.find((x) => x.id === id);
    }
    if (!q) {
      return { content: [{ type: "text", text: `질의회신 #${id} 없음` }] };
    }
    const section = (label, v) => {
      const items = parseJsonArray(v);
      return items.length ? `## ${label}\n${items.join("\n")}` : "";
    };
    const body =
      q.fullContent?.trim() ||
      [
        section("현황", q.nows),
        section("질의", q.question),
        section("회신", q.answer),
        section("근거", q.reason),
      ]
        .filter(Boolean)
        .join("\n\n") ||
      stripHtml(q.content);
    return {
      content: [
        {
          type: "text",
          text: `# ${q.title}\n일자: ${q.date ?? "-"} / 관련기준서: ${q.relStds ?? "-"} / 문서번호: ${q.docNumber || "-"}\n\n${body}`,
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
await login();
await server.connect(new StdioServerTransport());
console.error("[kifrs-mcp] MCP 서버 시작됨 (stdio)");
