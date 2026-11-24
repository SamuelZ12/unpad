import { expect, test } from "bun:test";
import { siteMatch } from "../../src/background/sites";

test("site access rejects star hostnames and keeps exact host permissions", () => {
  expect(siteMatch(new URL("https://*/article"))).toBeUndefined();
  expect(siteMatch(new URL("https://*.example.com/article"))).toBeUndefined();
  expect(siteMatch(new URL("https://news*room.example.com/article"))).toBeUndefined();
  expect(siteMatch(new URL("https://%2A.example.com/article"))).toBeUndefined();
  expect(siteMatch(new URL("https://news.example.com/article"))).toBe("https://news.example.com:443/*");
  expect(siteMatch(new URL("http://news.example.com:8080/article"))).toBe("http://news.example.com:8080/*");
});
