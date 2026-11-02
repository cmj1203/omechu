import { expect, test } from "./fixtures.js";

test("위치 칸은 추천 전에도 조건 칩 아래에 있고, 고른 곳은 추천할 때 찾는다", async ({ page }) => {
	await page.goto("/index.html");
	const place = page.locator(".place-choice #nearbyPlace");
	await expect(place).toBeVisible();
	await expect(page.locator("#nearby")).toBeHidden();

	await place.click();
	await page.locator(".place-picker-form input").fill("강남역");
	await page.locator(".place-picker-form button").click();
	await page.locator(".place-picker-results button").first().click();
	await expect(place).toHaveValue("강남역 2호선");
	await expect(page.locator(".restaurant-card")).toHaveCount(0);

	await page.locator("#recommend:not([disabled])").click();
	await expect(page.locator(".restaurant-card")).toBeVisible();
	await expect(place).toHaveValue("강남역 2호선");
});

test("추천 전에 현재 위치 단추를 누르면 위치만 칸에 넣고 가게는 찾지 않는다", async ({ page }) => {
	await page.goto("/index.html");
	await page.locator("#nearbyCurrentBtn").click();
	await expect(page.locator("#nearbyPlace")).not.toHaveValue("");
	await expect(page.locator("#nearby")).toBeHidden();
	await page.locator("#recommend:not([disabled])").click();
	await expect(page.locator(".restaurant-card")).toBeVisible();
});

test("현재 위치를 잡은 뒤 다른 곳을 고르면 추천은 고른 곳에서 찾는다", async ({ page }) => {
	await page.goto("/index.html");
	const place = page.locator("#nearbyPlace");
	await page.locator("#nearbyCurrentBtn").click();
	await expect(place).not.toHaveValue("");

	await place.click();
	await page.locator(".place-picker-form input").fill("강남역");
	await page.locator(".place-picker-form button").click();
	await page.locator(".place-picker-results button").first().click();
	await expect(place).toHaveValue("강남역 2호선");

	await page.locator("#recommend:not([disabled])").click();
	await expect(page.locator(".restaurant-card")).toBeVisible();
	expect(await page.evaluate(() => window.__lastNearbyArgs.p_lat)).toBe(37.4979);
});
