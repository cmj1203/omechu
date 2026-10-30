import { expect, test } from "./fixtures.js";

test("추천 전에는 결과 칸에서 메뉴 이름이 흐르고, 추천받기를 누르면 돌다 고른 메뉴에서 멈춘다", async ({ page }) => {
	await page.goto("/index.html");
	const idle = page.locator(".slot.is-idle");
	await expect(idle).toBeVisible();
	await expect(idle.locator(".slot-reel")).toHaveCSS("animation-name", "slot-drift");

	// 조건을 바꿔도 추천 전이면 그 조건의 메뉴로 다시 흘러요
	await page.getByText("간식", { exact: true }).click();
	await expect(page.locator(".slot.is-idle")).toBeVisible();

	await page.locator("#recommend:not([disabled])").click();
	await expect(page.locator(".slot:not(.is-idle)")).toBeVisible();
	await expect(page.locator(".menu-name")).toBeVisible();
	await expect(page.locator(".slot")).toHaveCount(0);
});

test("움직임 줄이기를 켠 기기에서는 슬롯이 멈춰 있고 바로 결과가 나온다", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/index.html");
	await expect(page.locator(".slot.is-idle .slot-reel")).toHaveCSS("animation-name", "none");
	await page.locator("#recommend:not([disabled])").click();
	await expect(page.locator(".menu-name")).toBeVisible();
	await expect(page.locator(".slot")).toHaveCount(0);
});
