// Covers: R9
import { describe, expect, test } from "bun:test";
import {
  ADDRESS_RANGES,
  LOCAL_ALLOWABLE_RANGES,
  classifyAddress,
  isIpLiteral,
  type AddressRange,
} from "../../../src/security/ssrf.ts";

const V4: [string, AddressRange, string][] = [
  ["0.1.2.3", "unspecified", "0.0.0.0/8"],
  ["10.255.0.1", "private", "10.0.0.0/8"],
  ["100.64.0.1", "shared", "100.64.0.0/10"],
  ["100.127.255.255", "shared", "100.64.0.0/10"],
  ["100.100.100.200", "metadata", "100.100.100.200/32"],
  ["127.0.0.1", "loopback", "127.0.0.0/8"],
  ["169.254.169.254", "metadata", "169.254.169.254/32"],
  ["169.254.1.1", "link-local", "169.254.0.0/16"],
  ["172.16.0.1", "private", "172.16.0.0/12"],
  ["172.31.255.255", "private", "172.16.0.0/12"],
  ["192.0.0.9", "reserved", "192.0.0.0/24"],
  ["192.0.2.7", "documentation", "192.0.2.0/24"],
  ["192.88.99.1", "reserved", "192.88.99.0/24"],
  ["192.168.1.1", "private", "192.168.0.0/16"],
  ["198.19.255.255", "benchmarking", "198.18.0.0/15"],
  ["198.51.100.1", "documentation", "198.51.100.0/24"],
  ["203.0.113.1", "documentation", "203.0.113.0/24"],
  ["239.255.255.250", "multicast", "224.0.0.0/4"],
  ["240.0.0.1", "reserved", "240.0.0.0/4"],
  ["255.255.255.255", "broadcast", "255.255.255.255/32"],
];
const V4_PUBLIC = [
  "8.8.8.8",
  "1.1.1.1",
  "172.15.255.255",
  "172.32.0.0",
  "100.63.255.255",
  "100.128.0.0",
  "93.184.216.34",
];

const V6: [string, AddressRange, string][] = [
  ["::", "unspecified", "::/128"],
  ["::1", "loopback", "::1/128"],
  ["::ffff:127.0.0.1", "ipv4-mapped", "::ffff:0:0/96"],
  ["::ffff:7f00:1", "ipv4-mapped", "::ffff:0:0/96"],
  ["::2", "ipv4-embedded", "::/96"],
  ["64:ff9b::808:808", "ipv4-embedded", "64:ff9b::/96"],
  ["64:ff9b:1::1", "ipv4-embedded", "64:ff9b:1::/48"],
  ["100::1", "reserved", "100::/64"],
  ["2001::1", "ipv4-embedded", "2001::/32"],
  ["2001:1::1", "reserved", "2001::/23"],
  ["2001:db8::1", "documentation", "2001:db8::/32"],
  ["2002:c0a8:101::1", "ipv4-embedded", "2002::/16"],
  ["3fff::1", "documentation", "3fff::/20"],
  ["5f00::1", "reserved", "5f00::/16"],
  ["fd00:ec2::254", "metadata", "fd00:ec2::254/128"],
  ["fc00::1", "unique-local", "fc00::/7"],
  ["fd12:3456::1", "unique-local", "fc00::/7"],
  ["fe80::1", "link-local", "fe80::/10"],
  ["febf::1", "link-local", "fe80::/10"],
  ["fec0::1", "reserved", "fec0::/10"],
  ["ff02::1", "multicast", "ff00::/8"],
];

describe("classifyAddress", () => {
  test("classifies every special-purpose IPv4 and IPv6 block", () => {
    for (const [address, range, cidr] of [...V4, ...V6]) {
      expect(classifyAddress(address)).toMatchObject({ range, cidr });
    }
    for (const address of V4_PUBLIC) {
      expect(classifyAddress(address)).toMatchObject({
        family: 4,
        range: "public",
        cidr: null,
      });
    }
    // only 2000::/3 can be public; everything else outside the table is non-global
    expect(classifyAddress("2606:4700:4700::1111")).toMatchObject({
      range: "public",
      family: 6,
    });
    expect(classifyAddress("4000::1").range).toBe("non-global");
    expect(classifyAddress("8000::1").range).toBe("non-global");
    // unparseable fails closed
    for (const garbage of [
      "",
      "999.1.1.1",
      "1.2.3",
      "01.2.3.4",
      "1.2.3.4.5",
      "::g",
      "1::2::3",
      ":1",
      "x",
    ]) {
      expect(classifyAddress(garbage)).toMatchObject({
        range: "reserved",
        cidr: null,
      });
    }
    // brackets, zones and an IPv4 tail are normalised; the text is canonical
    expect(classifyAddress("[::1]").address).toBe("::1");
    expect(classifyAddress("fe80::1%eth0")).toMatchObject({
      address: "fe80::1",
      range: "link-local",
    });
    expect(classifyAddress("0:0:0:0:0:0:0:1").address).toBe("::1");
    expect(classifyAddress("2001:db8:0:0:1:0:0:1").address).toBe("2001:db8::1:0:0:1");
    expect(classifyAddress("2001:db8:1:2:3:4:5:6").address).toBe("2001:db8:1:2:3:4:5:6");
    expect(classifyAddress("::ffff:8.8.8.8")).toMatchObject({
      address: "::ffff:8.8.8.8",
      range: "ipv4-mapped",
    });
    expect(classifyAddress("0:0:0:0:0:ffff:1.2.3.4").range).toBe("ipv4-mapped");
    expect(classifyAddress("::ffff:1.2.3.999").range).toBe("reserved");
    expect(classifyAddress("1.2.3.4:80").range).toBe("reserved");
  });

  test("lists every range and the ones --allow-local may authorize", () => {
    expect(new Set(ADDRESS_RANGES).size).toBe(ADDRESS_RANGES.length);
    expect(LOCAL_ALLOWABLE_RANGES).toEqual(["loopback", "private", "shared", "unique-local"]);
    for (const range of LOCAL_ALLOWABLE_RANGES) expect(ADDRESS_RANGES).toContain(range);
    expect(isIpLiteral("127.0.0.1")).toBe(true);
    expect(isIpLiteral("[::1]")).toBe(true);
    expect(isIpLiteral("::1")).toBe(true);
    expect(isIpLiteral("fe80::1%eth0")).toBe(true);
    for (const text of ["example.com", "127.1", "0x7f.1", "2130706433", "[abc]", ""]) {
      expect(isIpLiteral(text)).toBe(false);
    }
  });
});
