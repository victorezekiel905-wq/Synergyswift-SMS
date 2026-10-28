import { test, expect, type Page } from "@playwright/test";

/**
 * Each role signs in to a seeded TEST copy of Synergy Swift and does its main job.
 * Set E2E_BASE_URL plus E2E_<ROLE>_EMAIL / E2E_<ROLE>_PASSWORD for OWNER, ADMIN,
 * TEACHER, PARENT and STUDENT (never real people's accounts). Roles without
 * accounts are skipped. Never point this at the live site: it creates records.
 */
const account = (role: string) => {
  const email = process.env[`E2E_${role}_EMAIL`], password = process.env[`E2E_${role}_PASSWORD`];
  return email && password ? { email, password } : null;
};

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByPlaceholder("Email or username").fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(u => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}

test.describe("each role's main job", () => {
  test.skip(!process.env.E2E_BASE_URL, "needs E2E_BASE_URL pointing at a test copy of the system");

  test("owner: platform console, onboarding codes and sign-ups", async ({ page }) => {
    const who = account("OWNER");
    test.skip(!who, "no E2E_OWNER account");
    await signIn(page, who!);
    await expect(page).toHaveURL(/\/platform/);
    await page.goto("/platform/codes");
    await page.getByLabel("Which school is it for?").fill(`E2E test school ${Date.now()}`);
    await page.getByRole("button", { name: "Make a code" }).click();
    await expect(page.getByText(/^SSC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)).toBeVisible();
    await expect(page.getByText(/It expires in (19|20):\d\d/)).toBeVisible();
    await page.goto("/platform/signups");
    await expect(page.getByRole("heading", { name: "Sign-ups" })).toBeVisible();
  });

  test("school admin: overview, head's summary and sign-ups", async ({ page }) => {
    const who = account("ADMIN");
    test.skip(!who, "no E2E_ADMIN account");
    await signIn(page, who!);
    await page.goto("/school");
    await expect(page.getByText("This week in plain words")).toBeVisible();
    await page.goto("/school/signups");
    await expect(page.getByRole("heading", { name: "Sign-ups to confirm" })).toBeVisible();
  });

  test("teacher: teaching day and the class register", async ({ page }) => {
    const who = account("TEACHER");
    test.skip(!who, "no E2E_TEACHER account");
    await signIn(page, who!);
    await page.goto("/teacher");
    await expect(page.locator("main")).toBeVisible();
    await page.goto("/school/attendance");
    await expect(page.locator("main")).not.toContainText("not found");
  });

  test("parent: children, and Ask the school", async ({ page }) => {
    const who = account("PARENT");
    test.skip(!who, "no E2E_PARENT account");
    await signIn(page, who!);
    await expect(page).toHaveURL(/\/parent/);
    const ask = page.getByRole("button", { name: "Ask the school" });
    if (await ask.isVisible()) {
      await ask.click();
      await expect(page.getByRole("region", { name: "Ask the school" })).toBeVisible();
    }
  });

  test("student: their day and homework", async ({ page }) => {
    const who = account("STUDENT");
    test.skip(!who, "no E2E_STUDENT account");
    await signIn(page, who!);
    await page.goto("/student");
    await expect(page.locator("main")).toBeVisible();
  });
});
