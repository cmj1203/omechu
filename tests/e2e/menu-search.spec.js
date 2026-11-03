import { expect, test } from "./fixtures.js";

// 상가정보 '한식/백반/한정식' 업종에는 트럭·회사 이름 같은 곳도 많아서, 더 가까워도 이름이 맞는 가게 뒤에 와야 해요(사용자 11-03).
// 가게가 둘인 배열은 Playwright 가 [값, 옵션] 쌍으로 읽어서, [값, 옵션] 모양으로 감싸 넘겨요.
test.use({
	places: [[
		["트럭", 50, null, { name: "대한트럭", category: "한식/백반/한정식" }],
		["생태", 400, null, { name: "목포생태찌개" }],
	], { scope: "test" }],
});

test("메뉴 검색은 이름이 맞는 가게를 업종으로만 맞는 더 가까운 가게보다 먼저 보여 준다", async ({ page }) => {
	await page.goto("/index.html");
	await page.locator("#menuQuery:not([disabled])").fill("백반");
	await page.locator("#menuQuery").press("Enter");
	const names = page.locator(".place-name-link");
	await expect(names).toHaveCount(2);
	await expect(names).toHaveText(["목포생태찌개", "대한트럭"]);
});
