import { expect, recommend, test } from "./fixtures.js";

// 휴대폰 폭(375px)에서 누르는 곳은 44px 안팎이고(보이는 크기는 작아도), 입력칸 글자는 16px 이상이어야 해요.
test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

// 요소 가운데에서 위아래로 한 칸씩 찍어 보며 그 요소(또는 그 label)가 잡히는 높이를 재요.
function tapHeight(element) {
	element.scrollIntoView({ block: "center" });
	const box = element.getBoundingClientRect();
	const own = element.closest("label") ?? element;
	const x = box.left + box.width / 2;
	const hits = (y) => {
		const found = document.elementFromPoint(x, y);
		return found && (own === found || own.contains(found));
	};
	let top = box.top + box.height / 2;
	let bottom = top;
	while (hits(top - 1)) top -= 1;
	while (hits(bottom + 1)) bottom += 1;
	return bottom - top;
}

test("추천 화면의 칩·단추는 누르는 높이 43px 이상", async ({ page }) => {
	await recommend(page);
	const targets = [
		"#filters .options span",
		"#nearbyOrder .options span",
		"#nearbyResult .restaurant-links a",
		"#nearbyResult .restaurant-links button",
		".another-button",
		".restaurant-name .favorite-button",
		".nearby-locate",
	];
	for (const selector of targets) {
		const heights = await page.locator(selector).evaluateAll((elements, measure) => elements.map(new Function("return " + measure)()), tapHeight.toString());
		expect(heights.length, selector).toBeGreaterThan(0);
		for (const height of heights) {
			expect(height, selector).toBeGreaterThanOrEqual(43);
		}
	}
});

test("모든 화면의 입력칸은 16px 이상이라 iOS가 확대하지 않는다", async ({ page }) => {
	for (const path of ["/index.html", "/official.html", "/vote.html", "/account.html", "/admin.html"]) {
		await page.goto(path);
		const sizes = await page.locator("input:not([type=radio]):not([type=checkbox]), select, textarea")
			.evaluateAll((inputs) => inputs.map((input) => parseFloat(getComputedStyle(input).fontSize)));
		for (const size of sizes) {
			expect(size, path).toBeGreaterThanOrEqual(16);
		}
	}
});
