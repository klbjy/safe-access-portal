import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.env.SAFE_ACCESS_BASE_URL ?? "http://127.0.0.1:4173";
const browserPath = process.env.SAFE_ACCESS_BROWSER;
const loginName = process.env.SAFE_ACCESS_TEST_NAME;
const studentId = process.env.SAFE_ACCESS_TEST_STUDENT_ID;
const outputDir = process.env.SAFE_ACCESS_SCREENSHOT_DIR;

if (!browserPath || !loginName || !studentId || !outputDir) {
  throw new Error("SAFE_ACCESS_BROWSER, SAFE_ACCESS_TEST_NAME, SAFE_ACCESS_TEST_STUDENT_ID and SAFE_ACCESS_SCREENSHOT_DIR are required");
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ executablePath: browserPath, headless: true });

try {
  for (const target of [
    { name: "desktop", viewport: { width: 1440, height: 1000 } },
    { name: "mobile", viewport: { width: 390, height: 844 }, isMobile: true },
  ]) {
    const context = await browser.newContext({ viewport: target.viewport, isMobile: target.isMobile });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByLabel("姓名").fill(loginName);
    await page.getByLabel("学号").fill(studentId);
    await page.getByRole("button", { name: "核验身份" }).click();
    await page.waitForURL("**/admin");
    await page.locator(".password-value").waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outputDir, `${target.name}.png`), fullPage: false });
    await context.close();
  }
} finally {
  await browser.close();
}
