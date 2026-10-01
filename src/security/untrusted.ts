/** Pure scanner for instruction-shaped and hidden text in external content (RN-36). Findings are data: nothing reads
 * them to decide behaviour. Every rule is a static literal without nested quantifiers, so a scan is linear. */

export const INSTRUCTION_RULE_IDS = [
  "override-instructions",
  "role-reassignment",
  "prompt-exfiltration",
  "secret-exfiltration",
  "command-execution",
  "chat-control-token",
  "concealment",
  "approval-bypass",
] as const;
export type InstructionRuleId = (typeof INSTRUCTION_RULE_IDS)[number];
export type InstructionRule = { id: InstructionRuleId; pattern: RegExp };

/** Static literals, flags "gi". */
export const INSTRUCTION_RULES: readonly InstructionRule[] = [
  {
    id: "override-instructions",
    pattern:
      /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|an[y]\s+|the\s+|your\s+)?(?:previous|prior|above|earlier|preceding|system)\s+(?:instructions?|prompts?|rules|directions|messages|context)\b/gi,
  },
  {
    id: "override-instructions",
    pattern:
      /\b(?:ignora|olvida|omite)\s+(?:todas\s+)?(?:las\s+)?(?:instrucciones|reglas|indicaciones)\s+(?:anteriores|previas)\b/gi,
  },
  {
    id: "role-reassignment",
    pattern:
      /\b(?:you\s+are\s+now|from\s+now\s+on\s+you|pretend\s+(?:to\s+be|you\s+are)|act\s+as\s+(?:an?\s+|the\s+)?(?:ai|assistant|system|developer|admin(?:istrator)?|root))\b/gi,
  },
  {
    id: "prompt-exfiltration",
    pattern:
      /\b(?:reveal|print|show|repeat|output|leak)\s+(?:your|the)\s+(?:system\s+|hidden\s+|initial\s+|original\s+)?(?:prompt|instructions)\b/gi,
  },
  {
    id: "secret-exfiltration",
    pattern:
      /\b(?:send|post|upload|leak|exfiltrate|share|email)\s+(?:the\s+|your\s+|all\s+|an[y]\s+)?(?:api[\s_-]?keys?|tokens?|secrets?|passwords?|credentials|env(?:ironment)?\s+variables)\b/gi,
  },
  {
    id: "command-execution",
    pattern:
      /\b(?:run|execute)\s+(?:the\s+following\s+|this\s+)?(?:command|shell\s+command|script)\b|\bcurl\s[^\n|]{1,200}\|\s*(?:ba|z)?sh\b|\brm\s+-rf\b/gi,
  },
  {
    id: "chat-control-token",
    pattern: /<\|(?:im_start|im_end|system|endoftext)\|>|\[\/?INST\]|<\/?(?:system|assistant)>/gi,
  },
  {
    id: "concealment",
    pattern:
      /\b(?:do\s+not|don't)\s+(?:tell|inform|mention\s+(?:this\s+)?to)\s+the\s+user\b|\bwithout\s+telling\s+the\s+user\b/gi,
  },
  {
    id: "approval-bypass",
    pattern:
      /\b(?:approve|bypass|skip|auto-approve)\s+(?:the\s+|all\s+|every\s+)?(?:[a-z-]{1,30}\s+)?(?:gates?|reviews?|validations?|approvals?)\b/gi,
  },
];

export const MAX_SCAN_FINDINGS = 100;
const MAX_PHRASE = 200;

export type TextScanFinding = {
  code: "SUSPICIOUS_INSTRUCTION" | "HIDDEN_TEXT";
  rule: InstructionRuleId | "hidden-character";
  phrase: string;
  offset: number;
  line: number;
};

/** U+00AD, U+180E, U+200B-U+200F, U+202A-U+202E, U+2060-U+2064, U+2066-U+2069 and U+FEFF (only after offset 0, where it is a BOM). and the tag block U+E0000-U+E007F (a surrogate pair in UTF-16, reported by code point). */
function isHidden(code: number, offset: number): boolean {
  return (
    code === 0x00ad ||
    code === 0x180e ||
    (code >= 0xe0000 && code <= 0xe007f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    (code >= 0x2066 && code <= 0x2069) ||
    (code === 0xfeff && offset > 0)
  );
}

type Raw = Omit<TextScanFinding, "line">;

/** 1-based line of every offset in `sorted` (ascending), in one pass over the text. */
function linesOf(text: string, offsets: readonly number[]): number[] {
  const lines: number[] = [];
  let line = 1;
  let cursor = 0;
  for (const offset of offsets) {
    for (
      let at = text.indexOf("\n", cursor);
      at !== -1 && at < offset;
      at = text.indexOf("\n", cursor)
    ) {
      line += 1;
      cursor = at + 1;
    }
    lines.push(line);
  }
  return lines;
}

/** Linear. Rules + hidden characters, sorted by offset then rule; at most MAX_SCAN_FINDINGS (truncated = true beyond). */
export function scanUntrustedText(text: string): {
  findings: TextScanFinding[];
  truncated: boolean;
} {
  const raw: Raw[] = [];
  const limit = MAX_SCAN_FINDINGS + 1; // one extra candidate is enough to know the list was cut
  for (const { id, pattern } of INSTRUCTION_RULES) {
    let kept = 0;
    for (const match of text.matchAll(pattern)) {
      raw.push({
        code: "SUSPICIOUS_INSTRUCTION",
        rule: id,
        phrase: match[0].slice(0, MAX_PHRASE),
        offset: match.index,
      });
      kept += 1;
      if (kept >= limit) break;
    }
  }
  let hidden = 0;
  for (let offset = 0; offset < text.length && hidden < limit; offset += 1) {
    let code = text.charCodeAt(offset);
    const low = text.charCodeAt(offset + 1);
    if (code === 0xdb40 && low >= 0xdc00 && low <= 0xdc7f) code = 0xe0000 + (low - 0xdc00);
    if (isHidden(code, offset)) {
      raw.push({
        code: "HIDDEN_TEXT",
        rule: "hidden-character",
        phrase: `U+${code.toString(16).toUpperCase().padStart(4, "0")}`,
        offset,
      });
      hidden += 1;
      if (code >= 0xe0000) offset += 1; // skip the low surrogate of the tag character
    }
  }
  raw.sort((a, b) => a.offset - b.offset || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
  const kept = raw.slice(0, MAX_SCAN_FINDINGS);
  const lines = linesOf(
    text,
    kept.map((finding) => finding.offset),
  );
  return {
    findings: kept.map((finding, index) => ({
      ...finding,
      line: lines[index] ?? 1,
    })),
    truncated: raw.length > MAX_SCAN_FINDINGS,
  };
}
