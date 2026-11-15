import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
page.on("pageerror", error => console.error(error));
for (const [label, width, height] of [["desktop", 1440, 900], ["mobile", 390, 844]]) {
	await page.setViewportSize({ width, height });
	await page.goto("http://127.0.0.1:5173/plugins");
	await page.getByRole("button", { name: "Update to 0.3.1", exact: true }).waitFor();
	await page.evaluate(() => document.fonts.ready);
	await page.screenshot({ path: `temp/plugin-layout/${process.argv[2]}-${label}.png` });
	console.log(label, await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
		rowHeights: [...document.querySelectorAll(".ant-table-tbody > tr")].map(row => row.getBoundingClientRect().height) })));
}
await browser.close();
