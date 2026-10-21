import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.env.SAFE_ACCESS_BASE_URL ?? "http://127.0.0.1:4173";
const browserPath = process.env.SAFE_ACCESS_BROWSER;
const loginName = process.env.SAFE_ACCESS_TEST_NAME;
const studentId = process.env.SAFE_ACCESS_TEST_STUDENT_ID;
const volunteerName = process.env.SAFE_ACCESS_TEST_VOLUNTEER_NAME;
const volunteerStudentId = process.env.SAFE_ACCESS_TEST_VOLUNTEER_STUDENT_ID;
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
    if (await page.getByText("不会要求设置个人密码").count()) throw new Error("Removed login footer copy is still visible");
    await page.getByLabel("姓名").fill(loginName);
    await page.getByLabel("学号").fill(studentId);
    await page.getByRole("button", { name: "核验身份" }).click();
    await page.waitForURL("**/#/admin");
    await page.locator(".password-value").waitFor();
    await page.getByText("当前显示线上配置").waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outputDir, `${target.name}.png`), fullPage: false });
    await page.getByRole("button", { name: "发布步骤" }).click();
    await page.waitForURL("**/#/publish");
    await page.getByRole("heading", { name: "发布新版配置" }).waitFor();
    await page.getByRole("link", { name: "打开 GitHub 上传页" }).waitFor();
    await context.close();
  }

  if (volunteerName && volunteerStudentId) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByLabel("姓名").fill(volunteerName);
    await page.getByLabel("学号").fill(volunteerStudentId);
    await page.getByRole("button", { name: "核验身份" }).click();
    await page.waitForURL("**/#/volunteer");
    await page.locator(".password-value").waitFor();
    await page.getByRole("button", { name: "复制密码" }).waitFor();
    await context.close();
  }
} finally {
  await browser.close();
}
