const dns = require("dns").promises;
const { Address4, Address6 } = require("ip-address");

const privateRangesv4 = [
  new Address4("10.0.0.0/8"),
  new Address4("172.16.0.0/12"),
  new Address4("192.168.0.0/16"),
  new Address4("127.0.0.0/8"),
  new Address4("169.254.0.0/16"),
  new Address4("0.0.0.0/8")
];

function isPrivateIPv4(addr) {
  return privateRangesv4.some((range) => range.isInSubnet(addr));
}

function isPrivateIPv6(addr) {
  if (addr.isLoopback()) return true;
  if (addr.is4()) {
    try {
      const v4 = addr.to4();
      const v4Str = v4 && (typeof v4 === "string" ? v4 : v4.address);
      if (v4Str) return isPrivateIPv4(new Address4(v4Str));
    } catch (_) {}
  }
  const rangeLinkLocal = new Address6("fe80::/10");
  const rangeUniqueLocal = new Address6("fc00::/7");
  return addr.isInSubnet(rangeLinkLocal) || addr.isInSubnet(rangeUniqueLocal);
}

function isPrivateIP(ipStr) {
  try {
    if (ipStr.includes(":")) {
      const addr = new Address6(ipStr);
      return isPrivateIPv6(addr);
    }
    const addr = new Address4(ipStr);
    return isPrivateIPv4(addr);
  } catch {
    return true;
  }
}

async function resolveHostToIPs(hostname) {
  const ips = [];
  try {
    const v4 = await dns.resolve4(hostname).catch(() => []);
    ips.push(...(v4 || []));
  } catch (_) {}
  try {
    const v6 = await dns.resolve6(hostname).catch(() => []);
    ips.push(...(v6 || []));
  } catch (_) {}
  return ips;
}

async function assertPublicHost(serverUrl) {
  let parsed;
  try {
    parsed = new URL(serverUrl);
  } catch {
    throw new Error("Invalid URL format");
  }
  const protocol = (parsed.protocol || "").toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("URL must use http or https protocol");
  }
  const hostname = parsed.hostname;
  if (!hostname) throw new Error("Invalid hostname");
  if (isPrivateIP(hostname)) {
    throw new Error("Private or local IP addresses are not allowed");
  }
  const ips = await resolveHostToIPs(hostname);
  if (ips.length === 0) {
    throw new Error("Could not resolve hostname to verify IP safety");
  }
  for (const ip of ips) {
    if (isPrivateIP(ip)) {
      throw new Error("Hostname resolves to a private or local IP");
    }
  }
  return parsed;
}

module.exports = { assertPublicHost };
