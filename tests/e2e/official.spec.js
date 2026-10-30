import { expect, test } from "./fixtures.js";

// 공무원 맛집의 위치 칸은 메뉴 추천과 같아요: 칸을 누르면 장소 검색 창, 칸 안 단추는 현재 위치.
test.describe("공무원 맛집 위치 칸", () => {
	test("위치 칸을 눌러 장소를 고르면 단추 없이 바로 그곳 근처를 찾는다", async ({ page }) => {
		await page.goto("/official.html");
		await page.locator("#officialPlace").click();
		await page.locator(".place-picker-form input").fill("강남역");
		await page.locator(".place-picker-form button").click();
		await page.locator(".place-picker-results button").first().click();
		await expect(page.locator("#officialPlace")).toHaveValue("강남역 2호선");
		await expect(page.locator("#officialListTitle")).toHaveText("강남역 2호선 근처");
		// 예전 '근처 찾기' 단추는 없어요.
		await expect(page.locator("#officialSearch button[type='submit']")).toHaveCount(0);
	});

	test("위치 칸에서 Enter 를 쳐도 장소 검색 창을 연다", async ({ page }) => {
		await page.goto("/official.html");
		await page.locator("#officialPlace").press("Enter");
		await expect(page.locator("#placePicker")).toBeVisible();
	});

	test("위치 칸 안의 현재 위치 단추로 찾으면 주소가 위치 칸에 들어간다", async ({ page }) => {
		await page.goto("/official.html");
		await page.getByRole("button", { name: "현재 위치로 찾기" }).click();
		await expect(page.locator("#officialListTitle")).toHaveText("현재 위치 근처");
		await expect(page.locator("#officialPlace")).toHaveValue("서울 중구 세종대로 110");
	});
});
