/** Pure IP classifier for the SSRF policy (DR12): IANA special-purpose registries, no dependencies. */

export const ADDRESS_RANGES = [
  "public",
  "unspecified",
  "loopback",
  "private",
  "shared",
  "link-local",
  "metadata",
  "multicast",
  "broadcast",
  "reserved",
  "documentation",
  "benchmarking",
  "ipv4-mapped",
  "ipv4-embedded",
  "unique-local",
  "non-global",
] as const;
export type AddressRange = (typeof ADDRESS_RANGES)[number];
/** The only non-public ranges `--allow-local` may authorize (DR11). */
export const LOCAL_ALLOWABLE_RANGES: readonly AddressRange[] = [
  "loopback",
  "private",
  "shared",
  "unique-local",
];
/** `cidr` is the matched block; `address` is the canonical text. */
export type AddressClass = {
  address: string;
  family: 4 | 6;
  range: AddressRange;
  cidr: string | null;
};

type V4Block = readonly [cidr: string, range: AddressRange];
type V6Block = readonly [cidr: string, range: AddressRange];

const V4_BLOCKS: readonly V4Block[] = [
  ["0.0.0.0/8", "unspecified"],
  ["10.0.0.0/8", "private"],
  ["100.64.0.0/10", "shared"],
  ["100.100.100.200/32", "metadata"],
  ["127.0.0.0/8", "loopback"],
  ["169.254.169.254/32", "metadata"],
  ["169.254.0.0/16", "link-local"],
  ["172.16.0.0/12", "private"],
  ["192.0.0.0/24", "reserved"],
  ["192.0.2.0/24", "documentation"],
  ["192.88.99.0/24", "reserved"],
  ["192.168.0.0/16", "private"],
  ["198.18.0.0/15", "benchmarking"],
  ["198.51.100.0/24", "documentation"],
  ["203.0.113.0/24", "documentation"],
  ["224.0.0.0/4", "multicast"],
  ["240.0.0.0/4", "reserved"],
  ["255.255.255.255/32", "broadcast"],
];

const V6_BLOCKS: readonly V6Block[] = [
  ["::/128", "unspecified"],
  ["::1/128", "loopback"],
  ["::ffff:0:0/96", "ipv4-mapped"],
  ["::/96", "ipv4-embedded"],
  ["64:ff9b::/96", "ipv4-embedded"],
  ["64:ff9b:1::/48", "ipv4-embedded"],
  ["100::/64", "reserved"],
  ["2001::/32", "ipv4-embedded"], // Teredo
  ["2001::/23", "reserved"],
  ["2001:db8::/32", "documentation"],
  ["2002::/16", "ipv4-embedded"], // 6to4
  ["3fff::/20", "documentation"],
  ["5f00::/16", "reserved"],
  ["fd00:ec2::254/128", "metadata"],
  ["fc00::/7", "unique-local"],
  ["fe80::/10", "link-local"],
  ["fec0::/10", "reserved"],
  ["ff00::/8", "multicast"],
];

const HEX_GROUP = /^[0-9a-f]{1,4}$/i;

/** Canonical dotted-quad only: four decimal octets 0-255 without leading zeros. */
function parseIpv4(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (part === "" || part.length > 3 || (part.length > 1 && part.startsWith("0"))) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet > 255 || !/^\d+$/.test(part)) return null;
    value = value * 256 + octet;
  }
  return value;
}

function parseGroups(text: string): number[] | null {
  if (text === "") return [];
  const out: number[] = [];
  const parts = text.split(":");
  for (const [index, part] of parts.entries()) {
    if (index === parts.length - 1 && part.includes(".")) {
      const tail = parseIpv4(part);
      if (tail === null) return null;
      out.push(Math.floor(tail / 65536), tail % 65536);
    } else if (HEX_GROUP.test(part)) {
      out.push(Number.parseInt(part, 16));
    } else {
      return null;
    }
  }
  return out;
}

/** 128-bit value of an IPv6 text ("::" and an IPv4 tail supported), or null. */
function parseIpv6(text: string): bigint | null {
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = parseGroups(halves[0] ?? "");
  if (head === null) return null;
  let groups: number[];
  if (halves.length === 1) {
    groups = head;
    if (groups.length !== 8) return null;
  } else {
    const tail = parseGroups(halves[1] ?? "");
    if (tail === null) return null;
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    groups = [...head, ...Array.from({ length: fill }, () => 0), ...tail];
  }
  return groups.reduce((acc, group) => (acc << 16n) | BigInt(group), 0n);
}

/** Brackets and the %zone suffix removed. */
function stripHost(hostname: string): string {
  const unbracketed =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  const zone = unbracketed.indexOf("%");
  return zone === -1 ? unbracketed : unbracketed.slice(0, zone);
}

function ipv4Text(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join(".");
}

function ipv6Text(value: bigint): string {
  const groups = Array.from({ length: 8 }, (_, i) =>
    Number((value >> BigInt((7 - i) * 16)) & 0xffffn),
  );
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return `::ffff:${ipv4Text((groups[6] ?? 0) * 65536 + (groups[7] ?? 0))}`;
  }
  let bestStart = -1;
  let bestLength = 0;
  for (let start = 0; start < 8; start += 1) {
    let length = 0;
    while (start + length < 8 && groups[start + length] === 0) length += 1;
    if (length > bestLength) {
      bestStart = start;
      bestLength = length;
    }
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestLength < 2) return hex.join(":");
  return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLength).join(":")}`;
}

/** Longest-prefix block of a table that contains `value`. */
function matchV4(value: number): V4Block | null {
  let best: V4Block | null = null;
  let bestBits = -1;
  for (const block of V4_BLOCKS) {
    const [base, bits] = block[0].split("/");
    const length = Number(bits);
    const baseValue = parseIpv4(base ?? "") ?? 0;
    const size = 2 ** (32 - length);
    if (Math.floor(value / size) === Math.floor(baseValue / size) && length > bestBits) {
      best = block;
      bestBits = length;
    }
  }
  return best;
}

function matchV6(value: bigint): V6Block | null {
  let best: V6Block | null = null;
  let bestBits = -1;
  for (const block of V6_BLOCKS) {
    const [base, bits] = block[0].split("/");
    const length = Number(bits);
    const baseValue = parseIpv6(base ?? "") ?? 0n;
    const shift = BigInt(128 - length);
    if (value >> shift === baseValue >> shift && length > bestBits) {
      best = block;
      bestBits = length;
    }
  }
  return best;
}

/** Canonical dotted-quad IPv4 or IPv6 (brackets and %zone stripped, "::" and an embedded IPv4 tail supported).
 * Most specific block wins; unparseable -> { range: "reserved", cidr: null }; IPv6 outside 2000::/3 -> "non-global". */
export function classifyAddress(address: string): AddressClass {
  const text = stripHost(address.trim());
  const v4 = parseIpv4(text);
  if (v4 !== null) {
    const block = matchV4(v4);
    return {
      address: ipv4Text(v4),
      family: 4,
      range: block?.[1] ?? "public",
      cidr: block?.[0] ?? null,
    };
  }
  const v6 = parseIpv6(text);
  if (v6 === null)
    return {
      address: text,
      family: text.includes(":") ? 6 : 4,
      range: "reserved",
      cidr: null,
    };
  const block = matchV6(v6);
  const range: AddressRange = block?.[1] ?? (v6 >> 125n === 1n ? "public" : "non-global");
  return {
    address: ipv6Text(v6),
    family: 6,
    range,
    cidr: block?.[0] ?? (range === "public" ? "2000::/3" : null),
  };
}

/** True for a canonical IPv4 literal or an IPv6 literal (with or without brackets / %zone). */
export function isIpLiteral(hostname: string): boolean {
  const text = stripHost(hostname);
  return parseIpv4(text) !== null || (text.includes(":") && parseIpv6(text) !== null);
}
