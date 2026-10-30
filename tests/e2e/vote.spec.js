import { expect, recommend, test } from "./fixtures.js";

// 같은 브라우저에서 친구 차례를 흉내 내요: 투표자 글자열을 바꾸고 방장 키를 숨겨요(가짜 DB는 localStorage 라 그대로 남아요).
async function becomeFriend(page, voter) {
	await page.evaluate((id) => {
		for (const key of Object.keys(localStorage)) {
			if (key.startsWith("omechu.pollHost.")) {
				sessionStorage.setItem(key, localStorage.getItem(key));
				localStorage.removeItem(key);
			}
		}
		localStorage.setItem("omechu.voterId", id);
	}, voter);
	await page.reload();
}

async function becomeHost(page, voter) {
	await page.evaluate((id) => {
		for (const key of Object.keys(sessionStorage)) {
			localStorage.setItem(key, sessionStorage.getItem(key));
		}
		localStorage.setItem("omechu.voterId", id);
	}, voter);
	await page.reload();
}

test("후보와 모일 곳으로 만들고, 모두 먹을 수 있는 메뉴만 방장이 정해 그 지역 식당으로 간다", async ({ page }) => {
	await recommend(page);
	await expect(page.locator("#nearbyPlace")).toHaveValue("서울 중구 세종대로 110");
	await page.getByRole("link", { name: "친구랑 같이 정하기" }).click();
	const chips = await page.locator(".vote-chip > span").allTextContents();
	expect(chips).toHaveLength(3);
	await expect(page.locator("#pollPlace")).toHaveValue("서울 중구 세종대로 110");

	// 모일 곳은 메인처럼 장소 검색 창에서 골라요
	await page.locator("#pollPlace").click();
	await page.locator(".place-picker-form input").fill("강남역");
	await page.locator(".place-picker-form button").click();
	await page.locator(".place-picker-results button").first().click();
	await expect(page.locator("#pollPlace")).toHaveValue("강남역 2호선");
	await page.getByRole("button", { name: "투표 만들기" }).click();

	// 방장도 답해요. 답하는 동안에는 결과를 숨겨요
	await expect(page.locator("#pollArea")).toHaveText("모일 곳 · 강남역 2호선");
	await expect(page.locator("#resultBox")).toBeHidden();
	const host = await page.evaluate(() => localStorage.getItem("omechu.voterId"));
	await page.getByRole("checkbox", { name: chips[0] }).check();
	await page.getByRole("checkbox", { name: chips[1] }).check();
	await page.getByRole("button", { name: "보내기" }).click();
	await expect(page.locator("#responders")).toHaveText("응답 1명");
	await expect(page.locator(".vote-result.is-common")).toHaveCount(2);

	// 친구: 답하기 전에는 결과가 안 보이고, 하나도 안 고르면 '다 못 먹어요'
	await becomeFriend(page, "friend-0001");
	await expect(page.locator("#resultBox")).toBeHidden();
	await page.getByRole("button", { name: "다 못 먹어요" }).click();
	await expect(page.locator("#resultNote")).toHaveText("모두 먹을 수 있는 메뉴가 없어요.");
	await expect(page.locator(".vote-result.is-common")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "이걸로 정하기" })).toHaveCount(0);

	// 친구가 답을 고치면 첫 후보만 모두 가능
	await page.getByRole("button", { name: "답 고치기" }).click();
	await page.getByRole("checkbox", { name: chips[0] }).check();
	await page.getByRole("button", { name: "보내기" }).click();
	await expect(page.locator(".vote-result.is-common .vote-option-name")).toHaveText([chips[0]]);
	await expect(page.locator(".vote-result").nth(1).locator(".vote-option-count")).toHaveText("1/2명");
	await expect(page.locator("#resultNote")).toHaveText("만든 사람이 정하면 여기에 나와요.");

	// 방장이 정하면 그 메뉴·지역으로 식당 찾기
	await becomeHost(page, host);
	await page.getByRole("button", { name: "이걸로 정하기" }).click();
	await expect(page.locator("#confirmedName")).toHaveText(chips[0]);
	await expect(page.locator("#answerForm")).toBeHidden();
	await page.getByRole("link", { name: "근처 식당 보기" }).click();
	await expect(page.locator(".menu-name")).toHaveText(chips[0]);
	await expect(page.locator("#nearbyPlace")).toHaveValue("강남역 2호선");
	await expect(page.locator(".restaurant-card")).toBeVisible();
});

test("링크가 틀리면 안내만 보여 준다", async ({ page }) => {
	await page.goto("/vote.html?id=00000000-0000-4000-8000-000000000000");
	await expect(page.locator("#noticeText")).toHaveText("투표를 찾을 수 없어요. 링크가 맞는지 확인해 주세요.");
});
