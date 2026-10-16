import { describe, it, expect } from "vitest";
import { signJwt, decodeJwt, verifyJwt, newPlatformKey, ltiRoles, launchClaims, checkAuthRequest, checkClientAssertion, parseScore, homeworkMark, autoPostPage, AGS } from "@/lib/lti";

const key = newPlatformKey();
const now = 1_800_000_000;

describe("tokens", () => {
  it("signs and verifies with the platform key (JWK)", () => {
    const t = signJwt({ iss: "https://school.app", aud: "c1", exp: now + 300, iat: now }, key.private_pem, key.kid);
    expect(decodeJwt(t)!.header).toMatchObject({ alg: "RS256", kid: key.kid });
    expect(verifyJwt(t, key.public_jwk, { iss: "https://school.app", aud: "c1", nowSec: now })).toMatchObject({ aud: "c1" });
    expect(verifyJwt(t, key.public_jwk, { aud: "other", nowSec: now })).toBe("wrong audience");
    expect(verifyJwt(t, key.public_jwk, { nowSec: now + 1000 })).toBe("token expired");
    expect(verifyJwt(t, newPlatformKey().public_jwk, { nowSec: now })).toBe("bad signature");
    expect(verifyJwt("a.b", key.public_jwk)).toBe("malformed token");
    expect(key.public_jwk).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig", kid: key.kid });
    expect(JSON.stringify(key.public_jwk)).not.toContain('"d"');
  });
});

describe("launch claims", () => {
  it("map roles", () => {
    expect(ltiRoles(["student"])).toContain("http://purl.imsglobal.org/vocab/lis/v2/membership#Learner");
    expect(ltiRoles(["teacher"])).toContain("http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor");
    expect(ltiRoles(["school_admin"])).toContain("http://purl.imsglobal.org/vocab/lis/v2/institution/person#Administrator");
    expect(ltiRoles(["bursar"])).toEqual(["http://purl.imsglobal.org/vocab/lis/v2/institution/person#Staff"]);
  });
  it("build a resource link launch", () => {
    const c = launchClaims({ issuer: "https://school.app", clientId: "c1", deploymentId: "d1", nonce: "n", nowSec: now,
      user: { id: "u1", name: "Ada Obi", given: "Ada", family: "Obi", email: null, roles: ["student"] },
      link: { id: "l1", title: "Circuits", targetLinkUri: "https://tool/launch", custom: { unit: "3" } },
      context: { id: "c", label: "JSS1A", title: "JSS1A Science" }, platform: { guid: "t1", name: "Greenfield" }, returnUrl: "https://school.app/student",
      ags: { lineitem: "https://school.app/api/lti/ags/l1/lineitem", lineitems: "https://school.app/api/lti/ags/l1" } });
    expect(c).toMatchObject({ iss: "https://school.app", aud: "c1", sub: "u1", nonce: "n", exp: now + 300, name: "Ada Obi" });
    expect(c.email).toBeUndefined();
    expect(c["https://purl.imsglobal.org/spec/lti/claim/message_type"]).toBe("LtiResourceLinkRequest");
    expect(c["https://purl.imsglobal.org/spec/lti/claim/version"]).toBe("1.3.0");
    expect(c["https://purl.imsglobal.org/spec/lti/claim/deployment_id"]).toBe("d1");
    expect(c["https://purl.imsglobal.org/spec/lti/claim/resource_link"]).toEqual({ id: "l1", title: "Circuits" });
    expect((c[AGS.claim] as any).scope).toContain(AGS.score);
  });
});

describe("checks", () => {
  const tool = { client_id: "c1", redirect_uris: ["https://tool/launch"], target_link_uri: "https://tool/launch" };
  const ok = { scope: "openid", response_type: "id_token", response_mode: "form_post", prompt: "none", client_id: "c1", redirect_uri: "https://tool/launch", login_hint: "x", nonce: "n" };
  const fresh = { created_at: new Date(now * 1000 - 60_000).toISOString(), used_at: null };
  it("accept a proper sign-in request", () => { expect(checkAuthRequest(ok, tool, fresh, now * 1000)).toBeNull(); });
  it("refuse bad ones", () => {
    expect(checkAuthRequest({ ...ok, redirect_uri: "https://evil/x" }, tool, fresh, now * 1000)).toMatch(/redirect_uri/);
    expect(checkAuthRequest({ ...ok, client_id: "c2" }, tool, fresh, now * 1000)).toMatch(/client_id/);
    expect(checkAuthRequest({ ...ok, nonce: null }, tool, fresh, now * 1000)).toMatch(/nonce/);
    expect(checkAuthRequest(ok, tool, { ...fresh, used_at: "x" }, now * 1000)).toMatch(/already used/);
    expect(checkAuthRequest(ok, tool, { created_at: new Date(now * 1000 - 600_000).toISOString(), used_at: null }, now * 1000)).toMatch(/expired/);
    expect(checkAuthRequest(ok, tool, null, now * 1000)).toMatch(/unknown/);
  });
  it("check a tool's token request", () => {
    expect(checkClientAssertion({ iss: "c1", sub: "c1", aud: "https://s/api/lti/token", jti: "j" }, "c1", "https://s/api/lti/token")).toBeNull();
    expect(checkClientAssertion({ iss: "c1", sub: "c2", aud: "https://s/api/lti/token", jti: "j" }, "c1", "https://s/api/lti/token")).toMatch(/client_id/);
    expect(checkClientAssertion({ iss: "c1", sub: "c1", aud: ["x"], jti: "j" }, "c1", "https://s/api/lti/token")).toMatch(/aud/);
  });
});

describe("scores", () => {
  const s = { userId: "u1", scoreGiven: 7, scoreMaximum: 10, activityProgress: "Completed", gradingProgress: "FullyGraded", timestamp: "2026-10-16T10:00:00Z" };
  it("read and scale to the homework", () => {
    const p = parseScore(s);
    expect(p).toMatchObject({ userId: "u1", scoreGiven: 7, comment: null });
    expect(homeworkMark(p as any, 20)).toBe(14);
    expect(homeworkMark(p as any, null)).toBe(70);
    expect(homeworkMark({ ...(p as any), gradingProgress: "Pending" }, 20)).toBeNull();
    expect(homeworkMark({ ...(p as any), scoreGiven: 12 }, 10)).toBe(10);
  });
  it("refuse bad scores", () => {
    expect(parseScore({ ...s, activityProgress: "Done" })).toMatch(/activityProgress/);
    expect(parseScore({ ...s, scoreMaximum: null })).toMatch(/scoreMaximum/);
    expect(parseScore({ ...s, scoreGiven: -1 })).toMatch(/0 or more/);
    expect(parseScore(null)).toMatch(/JSON/);
  });
});

it("posts forms safely", () => {
  const html = autoPostPage("https://tool/launch", { id_token: "a.b.c", state: '"><script>' });
  expect(html).toContain('action="https://tool/launch"');
  expect(html).toContain("&quot;&gt;&lt;script&gt;");
});
