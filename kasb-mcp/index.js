#!/usr/bin/env node
/**
 * kasb-mcp — 한국회계기준원(www.kasb.or.kr) 공개 자료를 감싸는 MCP 서버
 *
 * 통합검색·게시판 목록·상세 본문을 MCP 도구로 노출한다. 로그인이 필요하지 않으며,
 * 상세 페이지는 평범한 GET 주소라 결과의 url을 그대로 문서에 인용할 수 있다.
 *
 * 주의: 기준서 문단 원문을 제공하는 db.kasb.or.kr 은 robots.txt 가
 *       "User-agent: * / Disallow: /" 이므로 이 서버는 접근하지 않는다.
 *       문단 원문 조회는 kifrs MCP 를 사용한다.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = "https://www.kasb.or.kr";
const SITE_CD = "002000000000000";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) kasb-mcp/0.1 (personal use)";

// ---------------------------------------------------------------------------
// HTTP — JSESSIONID 를 한 번 받아 이후 요청에 재사용한다
// ---------------------------------------------------------------------------
let cookie = "";

async function ensureSession() {
  if (cookie) return;
  const res = await fetch(`${BASE}/`, { headers: { "User-Agent": UA } });
  const jar = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
  cookie = jar.join("; ");
  await res.text();
}

async function req(path, { method = "GET", form } = {}) {
  await ensureSession();
  const headers = { "User-Agent": UA, Referer: `${BASE}/`, Cookie: cookie };
  let body;
  if (form) {
    headers["Content-Type"] =
      "application/x-www-form-urlencoded; charset=UTF-8";
    body = new URLSearchParams(form).toString();
  }
  const url = path.startsWith("http") ? path : BASE + path;
  const res = await fetch(url, { method, headers, body });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

// ---------------------------------------------------------------------------
// HTML 유틸
// ---------------------------------------------------------------------------
const ENT = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", middot: "·", hellip: "…",
};

function decode(s) {
  return s.replace(/&([a-zA-Z]+|#\d+);/g, (m, k) => ENT[k] ?? m);
}

function text(html) {
  return decode(
    html
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function clip(s, n) {
  return s.length > n ? `${s.slice(0, n)}\n…(${s.length - n}자 생략)` : s;
}

// ---------------------------------------------------------------------------
// 통합검색
// ---------------------------------------------------------------------------
// 게시판마다 두 번째 키가 gubun(자료실 계열) 또는 ctgCd(질의회신 계열)로 다르다
const VIEW_RE =
  /\/front\/board\/View(\d+)\.do\?siteCd=([0-9]+)&(?:amp;)?seq=(\d+)&(?:amp;)?(gubun|ctgCd)=(\d+)/;

function viewUrl(m) {
  return `${BASE}/front/board/View${m[1]}.do?siteCd=${m[2]}&seq=${m[3]}&${m[4]}=${m[5]}`;
}

function parseSearch(html) {
  const total = html.match(/총\s*([\d,]+)\s*건/)?.[1] ?? "?";
  const blocks = [
    ...html.matchAll(
      /<div class="tal_list_wrap"[^>]*>([\s\S]*?)(?=<div class="tal_list_wrap"|<div class="paging|<\/section|$)/g
    ),
  ];
  const out = [];
  const seen = new Set(); // 카테고리 탭마다 같은 글이 반복되므로 전역으로 중복을 없앤다
  for (const [, block] of blocks) {
    for (const raw of block.split(/<li[\s>]/).slice(1)) {
      const m = raw.match(VIEW_RE);
      if (!m) continue;
      const key = `${m[1]}:${m[3]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // <li ...> 의 속성 부분을 버리고 내용만 남긴다
      const li = raw.slice(raw.indexOf(">") + 1);
      const t = text(li).split("\n").map((s) => s.trim()).filter(Boolean);
      const date = li.match(/(20\d{2}-\d{2}-\d{2})/)?.[1] ?? "";
      // 첫 줄은 게시판 이름(제정개정자료 등), 둘째 줄이 제목인 경우가 많다
      const dept = (t[0] ?? "").replace(/\s+/g, " ").slice(0, 30);
      const title = (t[1] ?? t[0] ?? "")
        .replace(/\s+/g, " ")
        .replace(/\s*20\d{2}-\d{2}-\d{2}\s*$/, "")
        .slice(0, 140);
      const snippet = t.slice(2).join(" ").replace(/\s+/g, " ").slice(0, 220);
      out.push({ dept, title, date, snippet, url: viewUrl(m) });
    }
  }
  return { total, items: out };
}

// ---------------------------------------------------------------------------
// 게시판 목록
// ---------------------------------------------------------------------------
const BOARDS = {
  질의회신요약: { path: "/front/board/allReplySummaryList.do", form: { replySummary: "Y" } },
  회계기준적용의견서: { path: "/front/board/opinionList.do", form: {} },
  보도자료: { path: "/front/board/comm020List.do", form: {} },
  회계기준자료실: { path: "/front/boardA/AccList2002.do", form: {} },
  기업회계기준전체: { path: "/front/board/accountingAllList.do", form: {} },
};

function parseRows(html) {
  const rows = [];
  for (const [, tr] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const t = text(tr).replace(/\s*\n\s*/g, " | ").replace(/\s+/g, " ").trim();
    if (!t || /^번호\s*\|/.test(t)) continue;
    // fn_Detail(40670,'016005') 처럼 인용부호가 붙는 게시판이 있다
    const d = tr.match(/fn_Detail\(\s*['"]?(\d+)['"]?\s*,\s*['"]?([A-Za-z0-9]+)['"]?/);
    const files = [...tr.matchAll(/([\w가-힣().\-]+\.(?:hwpx?|pdf|xlsx?|docx?|zip))/g)]
      .map((m) => m[1]);
    rows.push({
      text: t.replace(/다운로드 \| 파일 \| 다운로드 \| 선택/g, "").trim(),
      url: d
        ? `${BASE}/front/board/View${d[2]}.do?siteCd=${SITE_CD}&seq=${d[1]}&` +
          `${d[2].length > 4 ? "ctgCd" : "gubun"}=${d[2]}`
        : "",
      files: [...new Set(files)],
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 서버
// ---------------------------------------------------------------------------
const server = new McpServer({ name: "kasb", version: "0.1.0" });

server.registerTool(
  "search",
  {
    title: "한국회계기준원 통합검색",
    description:
      "www.kasb.or.kr 통합검색. 질의회신 요약, IFRS 해석위원회 논의 결과, 제정개정자료, " +
      "회계기준적용의견서, 행사·교육자료 등을 한 번에 찾는다. 결과의 url 은 로그인 없이 " +
      "열리는 공개 주소이므로 보고서에 그대로 인용할 수 있다.",
    inputSchema: {
      query: z.string().describe("검색어 (한국어)"),
      limit: z.number().int().min(1).max(50).default(15)
        .describe("반환할 최대 건수 (기본 15)"),
    },
  },
  async ({ query, limit = 15 }) => {
    const html = await req("/front/board/search.do", {
      method: "POST",
      form: { searchtext: query },
    });
    const { total, items } = parseSearch(html);
    if (items.length === 0) {
      return {
        content: [
          { type: "text", text: `"${query}" 총 ${total}건 — 상세 링크가 있는 항목은 없음` },
        ],
      };
    }
    const lines = items.slice(0, limit).map((it, i) =>
      [
        `${i + 1}. [${it.dept}] ${it.title}${it.date ? ` (${it.date})` : ""}`,
        it.snippet ? `   ${it.snippet}` : "",
        `   ${it.url}`,
      ]
        .filter(Boolean)
        .join("\n")
    );
    return {
      content: [
        {
          type: "text",
          text: `"${query}" 총 ${total}건 (상세 링크 ${items.length}건 중 ${Math.min(limit, items.length)}건 표시)\n\n${lines.join("\n\n")}`,
        },
      ],
    };
  }
);

server.registerTool(
  "get_document",
  {
    title: "게시물 상세 조회",
    description:
      "search 나 list_board 가 돌려준 url(또는 seq+gubun)로 게시물의 제목·등록일·첨부파일·본문을 조회한다.",
    inputSchema: {
      url: z.string().optional().describe("search 결과의 url 전체"),
      seq: z.number().int().optional().describe("게시물 번호 (url 대신 사용)"),
      gubun: z.string().optional()
        .describe("게시판 구분 코드. 자료실 계열은 4자리(예: 2002), 질의회신 계열은 6자리(예: 016005)"),
      maxChars: z.number().int().min(500).max(40000).default(9000)
        .describe("본문 최대 글자수 (기본 9000)"),
    },
  },
  async ({ url, seq, gubun, maxChars = 9000 }) => {
    let target = url;
    if (!target) {
      if (seq == null || !gubun) throw new Error("url 또는 seq+gubun 이 필요하다");
      const key = gubun.length > 4 ? "ctgCd" : "gubun";
      target = `${BASE}/front/board/View${gubun}.do?siteCd=${SITE_CD}&seq=${seq}&${key}=${gubun}`;
    }
    const html = await req(target);
    const body = text(html);
    const i = body.indexOf("상세내용");
    const main = i >= 0 ? body.slice(i) : body;
    const date =
      main.match(/(?:등록일|회신일자)\s*\n?\s*(20\d{2}-\d{2}-\d{2})/)?.[1] ?? "";
    const files = [
      ...new Set(
        [...html.matchAll(/([\w가-힣().\-_]+\.(?:hwpx?|pdf|xlsx?|docx?|zip))/g)].map(
          (m) => m[1]
        )
      ),
    ];
    return {
      content: [
        {
          type: "text",
          text:
            `${target}\n등록일: ${date || "-"}\n첨부: ${files.join(", ") || "-"}\n\n` +
            clip(main, maxChars),
        },
      ],
    };
  }
);

server.registerTool(
  "list_board",
  {
    title: "게시판 목록 조회",
    description:
      "지정한 게시판의 최신 목록을 반환한다. 게시판: " +
      Object.keys(BOARDS).join(", ") +
      ". 게시판 자체의 키워드·분류 필터는 서버가 일반 요청에 반응하지 않으므로, " +
      "키워드로 찾을 때는 search 도구를 사용한다.",
    inputSchema: {
      board: z.enum(Object.keys(BOARDS)).describe("게시판 이름"),
      page: z.number().int().min(1).default(1).describe("페이지 (기본 1)"),
    },
  },
  async ({ board, page = 1 }) => {
    const b = BOARDS[board];
    const html = await req(b.path, {
      method: "POST",
      form: { siteCd: SITE_CD, pageIndex: String(page), ...b.form },
    });
    const rows = parseRows(html);
    if (rows.length === 0) {
      return { content: [{ type: "text", text: `${board}: 목록을 찾지 못함` }] };
    }
    const lines = rows.map((r) =>
      [`· ${r.text.slice(0, 160)}`, r.url ? `  ${r.url}` : ""]
        .filter(Boolean)
        .join("\n")
    );
    return {
      content: [
        { type: "text", text: `${board} (${page}쪽) ${rows.length}건\n\n${lines.join("\n")}` },
      ],
    };
  }
);

server.registerTool(
  "list_standard_files",
  {
    title: "기준서 원문 파일 목록",
    description:
      "기업회계기준 게시판에서 기준명과 첨부된 HWP/PDF 파일명을 반환한다. " +
      "게시판 코드(listCode)는 사이트의 목록 번호이며 페이지 제목으로 어떤 기준인지 확인할 수 있다. " +
      "문단 단위 조회는 이 사이트에서 제공하지 않으므로 kifrs MCP 를 사용한다.",
    inputSchema: {
      listCode: z.enum(["2001", "3003", "3004", "3005", "3006", "3007", "3008", "3013"])
        .describe("기준서 목록 게시판 코드"),
    },
  },
  async ({ listCode }) => {
    const html = await req(`/front/board/List${listCode}.do`, {
      method: "POST",
      form: { siteCd: SITE_CD },
    });
    const heading =
      text(html.match(/<h[23][^>]*>([\s\S]{0,120}?)<\/h[23]>/)?.[1] ?? "") || `List${listCode}`;
    const rows = parseRows(html).filter((r) => r.files.length > 0);
    const lines = rows.map((r) => {
      const name = r.text.split("|")[0].trim();
      return `· ${name}\n  ${r.files.join(" / ")}`;
    });
    return {
      content: [
        {
          type: "text",
          text: `${heading} — ${rows.length}건\n\n${lines.join("\n")}`,
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
await server.connect(new StdioServerTransport());
console.error("[kasb-mcp] MCP 서버 시작됨 (stdio)");
