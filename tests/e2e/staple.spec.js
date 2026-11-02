import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures.js";

const menus = JSON.parse(readFileSync(new URL("../../data/menus.json", import.meta.url), "utf8"));
const noodles = menus.filter((menu) => menu.staple === "면").map((menu) => menu.name);

test("밥·면 칩은 식사를 골랐을 때만 보이고, 면을 고르면 면 메뉴만 추천한다", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/index.html");
	const staple = page.locator("#stapleChoice");
	await expect(staple).toBeHidden();

	await page.getByText("식사", { exact: true }).click();
	await expect(staple).toBeVisible();
	await staple.getByText("면", { exact: true }).click();
	for (let i = 0; i < 5; i += 1) {
		await page.locator("#recommend:not([disabled])").click();
		expect(noodles).toContain(await page.locator(".menu-name").textContent());
	}

	// 다른 종류로 바꾸면 숨기고 '전체'로 돌려 둬요
	await page.getByText("간식", { exact: true }).click();
	await expect(staple).toBeHidden();
	await page.getByText("식사", { exact: true }).click();
	await expect(staple.locator("input[value='전체']")).toBeChecked();
});
