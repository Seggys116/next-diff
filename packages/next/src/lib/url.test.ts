import assert from "node:assert/strict";
import test from "node:test";
import { isBlockedIp, isLocalHost, isRecognizedIp } from "./url.ts";

test("a public name is not treated as local", () => {
  assert.equal(isLocalHost("example.com"), false);
  assert.equal(isLocalHost("10.evil.com"), false);
  assert.equal(isLocalHost("127.evil.com"), false);
  assert.equal(isLocalHost("192.168.evil.com"), false);
  assert.equal(isLocalHost("169.254.evil.com"), false);
});

test("loopback names and private addresses are local", () => {
  assert.equal(isLocalHost("localhost"), true);
  assert.equal(isLocalHost("app.localhost"), true);
  assert.equal(isLocalHost("127.0.0.1"), true);
  assert.equal(isLocalHost("10.1.2.3"), true);
  assert.equal(isLocalHost("192.168.0.4"), true);
  assert.equal(isLocalHost("172.16.0.1"), true);
  assert.equal(isLocalHost("169.254.169.254"), true);
  assert.equal(isLocalHost("::1"), true);
  assert.equal(isLocalHost("fd00::1"), true);
  assert.equal(isLocalHost("fe80::1"), true);
  assert.equal(isBlockedIp("::ffff:169.254.169.254"), true);
  assert.equal(isBlockedIp("1.1.1.1"), false);
  assert.equal(isRecognizedIp("1.1.1.1"), true);
  assert.equal(isRecognizedIp("example.com"), false);
});
