import assert from "node:assert/strict";
import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
for (const width of [320, 390, 575, 767, 768, 1024, 1440]) {
	await page.setViewportSize({ width, height: 900 });
	await page.goto("http://127.0.0.1:5173/plugins");
	await page.getByRole("button", { name: "Update to 0.3.1", exact: true }).waitFor();
	const dimensions = await page.evaluate(() => ({
		width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
		columns: document.querySelectorAll("thead th").length,
		brand: document.querySelector(".site-layout-brand").getBoundingClientRect().height,
		overflow: [...document.querySelectorAll(".plugin-mobile-details, .plugin-mobile-details .ant-btn")]
			.filter(element => element.scrollWidth > element.clientWidth + 1).length,
	}));
	assert.equal(dimensions.scrollWidth, width);
	assert.equal(dimensions.columns, width < 768 ? 1 : 3);
	assert.equal(dimensions.overflow, 0);
	assert.ok(dimensions.brand < 50);
	console.log("Layout", width, dimensions);
}
for (const width of [390, 1440]) {
	await page.setViewportSize({ width, height: 900 });
	await page.goto("http://127.0.0.1:5173/plugins");
	const update = page.getByRole("button", { name: "Update to 2.1.0", exact: true }).filter({ hasNot: page.locator("[disabled]") });
	await page.locator(".ant-table-row").filter({ hasText: "Global Chat" }).getByRole("button").click();
	await page.getByRole("dialog", { name: "Update Global Chat 2.1.0" }).waitFor();
	assert.equal(new URL(page.url()).pathname, "/plugins");
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await page.getByRole("button", { name: "Restart pending (2)" }).click();
	await page.getByRole("dialog", { name: "Restart machines with a pending restart" }).waitFor();
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await page.getByRole("button", { name: "Account menu for Cooldude2606" }).click();
	await page.getByRole("menuitem", { name: "Cooldude2606" }).waitFor();
	await page.keyboard.press("Escape");
	await page.locator(".page-header-title").click();
	await page.locator(".ant-table-filter-trigger").click();
	await page.getByPlaceholder("Search plugins").fill("Global");
	assert.equal(await page.locator(".ant-table-row").count(), 1);
	await page.getByPlaceholder("Search plugins").press("Enter");
	await page.reload();
	await page.getByRole("link", { name: "Global Chat", exact: true }).waitFor();
	assert.equal(await page.locator(".ant-table-row").count(), 1);
	await page.getByRole("link", { name: "Global Chat", exact: true }).click();
	await page.getByText("Plugin navigation target").waitFor();
	await page.goto("http://127.0.0.1:5173/plugins");
	await page.getByRole("columnheader", { name: /Name/ }).click();
	await page.waitForFunction(() => document.querySelector(".ant-table-row")?.textContent.startsWith("Research Sync"));
	assert.match(await page.locator(".ant-table-row").first().innerText(), /Research Sync/);
	await page.locator(".ant-table-row").first().click();
	await page.getByText("Plugin navigation target").waitFor();
	console.log("Interactions passed", width);
}
assert.deepEqual(errors, []);
await browser.close();
