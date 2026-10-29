import { test, expect, type Page } from "@playwright/test";

/**
 * The public site and the sign-up flows, in a real browser. Server replies that
 * would need a database are stubbed, so these run against any build.
 */

/** Fails the test on any uncaught page error, and checks nothing is wider than the screen. */
async function healthy(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e)));
  return async () => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "no sideways scrolling").toBeLessThanOrEqual(1);
    expect(errors, "no errors in the page").toEqual([]);
  };
}

test.describe("welcome page", () => {
  test("tells the story and leads to onboarding, the tour and guest joining", async ({ page, isMobile }) => {
    const check = await healthy(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Every part of the school, in step.");
    await expect(page.getByRole("img", { name: /Synergy Swift mark at the centre of a dial/ })).toBeVisible();
    if (isMobile) {
      await page.getByLabel("Menu").click();
      await expect(page.getByRole("navigation", { name: "Main" }).last().getByRole("link", { name: "Take a tour" })).toBeVisible();
    } else {
      for (const name of ["Features", "Take a tour", "Join a class", "Sign in"]) await expect(page.getByRole("banner").getByRole("link", { name })).toBeVisible();
    }
    await expect(page.getByRole("banner").getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/onboard");
    await expect(page.getByRole("heading", { name: "One record. Six offices. Nothing typed twice." })).toBeVisible();
    await expect(page.locator("#features")).toContainText("Everything your school runs on.");
    await expect(page.locator("#pricing")).toHaveCount(0);
    await expect(page.getByText("a year")).toHaveCount(0);
    await check();
  });

  test("a student joins a lesson as a guest with just the code", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel(/Joining a lesson/).fill("482107");
    await page.getByRole("button", { name: "Join as a guest" }).click();
    await expect(page).toHaveURL(/\/live\/join\?code=482107/);
    await expect(page.getByText("482107")).toBeVisible();
    await expect(page.getByLabel("What's your name?")).toBeVisible();   // the name step, with the code carried over
  });
});

test.describe("take a tour", () => {
  test("plays like a screen recording: the cursor clicks, the screen answers; pause, step, jump", async ({ page }) => {
    const check = await healthy(page);
    await page.goto("/tour");
    const caption = page.locator("p[aria-live=polite]");
    await expect(caption).toContainText("1.1");
    await expect(caption).toContainText("1.2", { timeout: 7000 });
    await page.getByRole("button", { name: "Pause" }).click();
    const paused = await caption.textContent();
    await page.waitForTimeout(3000);
    await expect(caption).toHaveText(paused!);
    await page.getByRole("button", { name: "Forward one step" }).click();
    await expect(caption).toContainText("1.3");
    await page.getByRole("button", { name: /Pickup, bus and boarding/ }).first().click();
    await expect(page.getByText("app.synergyswift.ng/school/gate")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText("482-913")).toBeVisible();
    await check();
  });

  test("the old How it works address leads to the tour", async ({ page }) => {
    await page.goto("/how-it-works");
    await expect(page).toHaveURL(/\/tour$/);
  });
});

test.describe("features", () => {
  test("lists everything the system does, in eight areas", async ({ page }) => {
    const check = await healthy(page);
    await page.goto("/features");
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(9);   // eight areas and the closing band
    for (const t of ["Gate sign-in and sign-out", "Basic phones by USSD", "Your assessment pattern", "Library and e-books", "Class discussions"])
      await expect(page.getByRole("heading", { name: t })).toBeVisible();
    await check();
  });
});

test.describe("onboarding a school", () => {
  test("checks the one-time code, counts down, and ends at the inbox step", async ({ page }) => {
    const check = await healthy(page);
    let registered: Record<string, unknown> | null = null;
    await page.route("**/api/auth/school-code", r => JSON.parse(r.request().postData() ?? "{}").code === "SSC-AAAA-BBBB-CCCC"
      ? r.fulfill({ status: 404, json: { error: "That code isn't right, has been used, or has expired." } })
      : r.fulfill({ json: { ok: true, school: "Greenfield College", expires_at: new Date(Date.now() + 19 * 60_000).toISOString() } }));
    await page.route("**/api/auth/register", r => { registered = JSON.parse(r.request().postData() ?? "{}"); return r.fulfill({ json: { ok: true, status: "sent", email: "head@gf.ng" } }); });
    await page.goto("/onboard");
    await page.getByLabel("Onboarding code").fill("ssc aaaa bbbb cccc");
    await expect(page.getByLabel("Onboarding code")).toHaveValue("SSC-AAAA-BBBB-CCCC");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("That code isn't right")).toBeVisible();
    await page.getByLabel("Onboarding code").fill("SSCABCDEFGHJKMN");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByLabel("School name")).toHaveValue("Greenfield College");
    await expect(page.getByText(/Code good for 1[89]:\d\d/)).toBeVisible();
    await page.getByLabel("Your full name").fill("Ngozi Okonkwo");
    await page.getByLabel("Your email").fill("head@gf.ng");
    await page.getByLabel("Choose a password").fill("longenough1");
    await page.getByRole("button", { name: "Create the school" }).click();
    await expect(page.getByText("Check your inbox")).toBeVisible();
    expect(registered).toMatchObject({ as: "school", school_code: "SSC-ABCD-EFGH-JKMN", school_name: "Greenfield College", email: "head@gf.ng" });
    await check();
  });

  test("the old sign-up address leads to onboarding", async ({ page }) => {
    await page.goto("/signup");
    await expect(page).toHaveURL(/\/onboard$/);
  });
});

test.describe("signing in", () => {
  test("Forgot password sends the link through Synergy Swift", async ({ page }) => {
    let asked: Record<string, unknown> | null = null;
    await page.route("**/api/auth/email", r => { asked = JSON.parse(r.request().postData() ?? "{}"); return r.fulfill({ json: { ok: true, message: "If this email has an account, a link to choose a new password is on its way." } }); });
    await page.goto("/login");
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(page.getByText("Enter your email address first.")).toBeVisible();
    await page.getByPlaceholder("Email or username").fill("Head@GF.ng");
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(page.getByText(/a link to choose a new password is on its way/)).toBeVisible();
    expect(asked).toEqual({ action: "reset", email: "head@gf.ng" });
  });

  test("a student username is sent to the teacher, not emailed", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("Email or username").fill("ada.obi12");
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(page.getByText(/Ask your teacher for a new starting password/)).toBeVisible();
  });

  test("email links ask for a press before the one-time token is spent", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=abcdef1234567890&type=signup&next=/dashboard");
    await expect(page.getByRole("button", { name: "Confirm my email" })).toBeVisible();
    await page.goto("/auth/confirm?type=signup");
    await expect(page.getByText("This link is not complete.")).toBeVisible();
  });
});

test.describe("paying a Synergy Swift invoice", () => {
  test("a made-up link is refused", async ({ page }) => {
    await page.goto("/billing/not-a-real-link");
    await expect(page.getByText("This payment link isn't right.")).toBeVisible();
  });

  test("shows the invoice and opens Paystack", async ({ page }) => {
    await page.route("**/api/billing/*", r => r.request().method() === "GET"
      ? r.fulfill({ json: { school: "Greenfield College", email: "bursar@gf.ng", number: "SS-2026-0007", status: "open", kind: "renewal", amount: 900000, currency: "NGN",
          lines: [{ label: "Complete: one year", amount: 900000 }], period_start: "2027-01-01", period_end: "2027-12-31", due_at: null, paid_at: null, pay_online: true,
          company: "Synergy Swift Technologies Limited", bank_details: null } })
      : r.fulfill({ json: { url: "/how-it-works?paystack=1" } }));
    await page.goto("/billing/0123456789abcdef0123456789abcdef.AAAAAAAAAAAAAAAAAAAAAA");
    await expect(page.getByRole("heading", { name: "Greenfield College" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pay ₦900,000" })).toBeVisible();
    await page.getByRole("button", { name: "Pay ₦900,000" }).click();
    await expect(page).toHaveURL(/paystack=1/);
  });
});
