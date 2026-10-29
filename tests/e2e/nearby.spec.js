import { PLACES, expect, recommend, test } from "./fixtures.js";

test.describe("주변 식당 추천", () => {
	test("평점 우선이 기본이고, 리뷰 수까지 본 평점이 높은 열린 가게를 고른다", async ({ page }) => {
		await recommend(page);
		await expect(page.locator("#nearbyOrder input[value='rating']")).toBeChecked();
		// 닫힌(4.9·2,000개)·폐업(4.8)이 더 높아도 지금 문을 닫아서 빼고, 리뷰 12개 5.0보다 리뷰 1,500개 4.7을 골라요.
		await expect(page.locator(".restaurant-name .place-name-link")).toHaveText(/^인기/);
		await expect(page.locator(".restaurant-rating")).toHaveText("구글 평점 4.7 · 리뷰 1,500 · 영업 중");
		await expect(page.locator(".restaurant-hours")).toHaveText("영업시간 11:00~21:30");
	});

	test("목록에 평점은 구글 그대로, 리뷰 10개 미만·구글에 없는 가게는 '-', 닫은 가게는 '영업 종료'·'폐업'", async ({ page }) => {
		await recommend(page);
		const rows = page.locator(".others li");
		await expect(rows.filter({ hasText: /^조금/ }).locator(".rating-tag")).toHaveText("★ 5.0");
		await expect(rows.filter({ hasText: /^가까운/ }).locator(".rating-tag")).toHaveText("★ -");
		await expect(rows.filter({ hasText: /^닫힌/ }).locator(".open-tag")).toHaveText("영업 종료");
		await expect(rows.filter({ hasText: /^폐업/ }).locator(".open-tag")).toHaveText("폐업");
		await expect(page.locator(".nearby-footer")).toContainText("평점 © Google");
		// 평점이 높아도 지금 문 닫은 가게는 목록 맨 뒤
		await expect(rows.last()).toContainText(/^(닫힌|폐업)/);
		await expect(rows.nth(-2)).toContainText(/^(닫힌|폐업)/);
		await expect(rows.first()).toContainText(/^조금/);
	});

	test("거리 우선을 고르면 같은 위치에서 바로 가까운 열린 가게로 다시 고르고, 새로고침해도 기억한다", async ({ page }) => {
		await recommend(page);
		await page.locator("#nearbyOrder label", { hasText: "거리" }).click();
		await expect(page.locator(".restaurant-name .place-name-link")).toHaveText(/^가까운/);
		// 구글에 없는 가게는 영업시간을 모르니 '--:--'
		await expect(page.locator(".restaurant-hours")).toHaveText("영업시간 --:--");
		await page.reload();
		await page.locator("#recommend:not([disabled])").click();
		await expect(page.locator("#nearbyOrder input[value='distance']")).toBeChecked();
		await expect(page.locator(".restaurant-name .place-name-link")).toHaveText(/^가까운/);
	});

	test("'다른 가게'는 보여 준 가게를 빼고 다시 고르고, 열린 가게를 다 돌면 처음부터", async ({ page }) => {
		await recommend(page);
		const name = page.locator(".restaurant-name .place-name-link");
		const prefixes = PLACES.map(([prefix]) => prefix);
		const seen = [];
		for (let i = 0; i < 5; i += 1) {
			const text = await name.textContent();
			seen.push(prefixes.find((prefix) => text.startsWith(prefix)));
			await page.locator(".another-button").click();
			await expect(page.locator(".restaurant-card")).toBeVisible();
		}
		// 열린 가게 다섯 곳(인기·조금·가까운·둘째·셋째)을 평점 순으로 돌고 다시 인기로. 닫힌·폐업은 안 나와요.
		expect(seen).toEqual(["인기", "조금", "가까운", "둘째", "셋째"]);
		await expect(name).toHaveText(/^인기/);
	});

	test("위치 칸 안의 현재 위치 단추로 추천하면 주소가 위치 칸에 들어가고 결과는 '현재 위치에서'", async ({ page }) => {
		await page.goto("/index.html");
		await page.evaluate(() => navigator.permissions.query = async () => ({ state: "prompt" }));
		await page.locator("#recommend:not([disabled])").click();
		await expect(page.locator(".restaurant-card")).toHaveCount(0);
		await page.getByRole("button", { name: "현재 위치로 추천받기" }).click();
		await expect(page.locator(".restaurant-walk")).toHaveText(/^현재 위치에서 도보/);
		await expect(page.locator("#nearbyPlace")).toHaveValue("서울 중구 세종대로 110");
	});

	test("위치 칸을 눌러 장소를 고르면 단추 없이 바로 그곳으로 추천한다", async ({ page }) => {
		await recommend(page);
		await page.locator("#nearbyPlace").click();
		await page.locator(".place-picker-form input").fill("강남역");
		await page.locator(".place-picker-form button").click();
		await page.locator(".place-picker-results button").first().click();
		await expect(page.locator(".restaurant-walk")).toHaveText(/^강남역 2호선에서 도보/);
		// 예전 '주변 ○○ 식당 추천' 단추는 없어요.
		await expect(page.locator("#nearbyBtn")).toHaveCount(0);
	});
});

test.describe("구글 키가 없을 때", () => {
	test.use({ googleKey: false });

	test("평점·영업 상태·추천 기준 칩 없이 가까운 순으로 고른다", async ({ page }) => {
		await recommend(page);
		await expect(page.locator("#nearbyOrder")).toBeHidden();
		await expect(page.locator(".restaurant-rating")).toHaveCount(0);
		await expect(page.locator(".rating-tag")).toHaveCount(0);
		await expect(page.locator(".restaurant-name .place-name-link")).toHaveText(/^가까운/);
		await expect(page.locator(".nearby-footer")).not.toContainText("Google ·");
	});
});
