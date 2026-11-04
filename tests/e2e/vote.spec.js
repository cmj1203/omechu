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
	await expect(page.locator(".vote-candidate-name")).toHaveCount(3);
	const chips = await page.locator(".vote-candidate-name").allTextContents();
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

// 메인이 첫 후보에 붙여 넘기는 식당(계획의 식당 객체 모양)
const RESTAURANT = { key: "목포생태찌개|37.56700|126.97900", name: "목포생태찌개", address: "서울 중구 서소문로 20", phone: "02-111-2222", lat: 37.567, lng: 126.979 };
const CREATE_URL = "/vote.html?" + new URLSearchParams({ menus: "백반,돈까스,쌀국수", place: "시청역", lat: "37.5665", lng: "126.978", restaurant: JSON.stringify(RESTAURANT) });

// 공유 창은 없는 것으로 두고, 복사한 글을 window.__shared 에 남기다가 읽어요.
async function captureShare(page) {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
		// 가게 이름 링크가 먼저 여는 빈 창(about:blank)에는 clipboard 가 없어요.
		if (navigator.clipboard) {
			navigator.clipboard.writeText = (text) => {
				window.__shared = text;
				return Promise.resolve();
			};
		}
	});
}

test("URL로 넘어온 식당은 첫 후보에 붙고, 만들기·답하기·결과·정한 뒤 화면에 식당이 보인다", async ({ page }) => {
	await captureShare(page);
	await page.goto(CREATE_URL);
	const rows = page.locator(".vote-candidate");
	await expect(rows).toHaveCount(3);
	await expect(rows.nth(0).locator(".vote-candidate-restaurant")).toHaveText("목포생태찌개");
	// 가게 이름은 메인처럼 가게 페이지 링크예요(마우스를 올리면 밑줄)
	await expect(rows.nth(0).locator(".vote-candidate-restaurant .place-name-link")).toHaveAttribute("href", /search\.naver\.com/);
	await expect(page.getByRole("button", { name: "식당 붙이기" })).toHaveCount(2);

	// 떼면 '식당 붙이기'로 돌아가요
	await page.getByRole("button", { name: "백반 식당 떼기" }).click();
	await expect(rows.nth(0).locator(".vote-candidate-restaurant")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "식당 붙이기" })).toHaveCount(3);

	// 메뉴 이름인 후보(백반)는 추천처럼 고른 가게(평점 우선 → 인기백반)가 맨 위에 오고, 누르면 붙어요
	await page.getByRole("button", { name: "백반 식당 붙이기" }).click();
	const dialog = page.locator("#restaurantPicker");
	await expect(dialog).toBeVisible();
	await expect(dialog.locator(".restaurant-picker-title")).toHaveText("백반 · 시청역 근처");
	const first = dialog.locator(".place-picker-results button").first();
	await expect(first.locator("strong")).toHaveText("인기백반");
	await expect(first.locator(".place-pick-walk")).toHaveText("도보 약 14분 · 700m");
	await expect(first.locator(".place-pick-address")).toHaveText("서울 중구 세종대로 110");
	await first.click();
	await expect(dialog).toBeHidden();
	await expect(rows.nth(0).locator(".vote-candidate-restaurant")).toHaveText("인기백반");

	// 메뉴에 없는 이름(돈까스)은 이름에 그 말이 든 가게를 가까운 순으로
	await page.getByRole("button", { name: "돈까스 식당 붙이기" }).click();
	await expect(dialog.locator(".place-picker-results button strong").first()).toHaveText("가까운돈까스");
	await dialog.locator(".place-picker-results button").first().click();
	await expect(rows.nth(1).locator(".vote-candidate-restaurant")).toHaveText("가까운돈까스");

	// 투표를 만들면 답하기 줄에 식당이 붙은 후보만 식당 칸이 있어요
	await page.getByRole("button", { name: "투표 만들기" }).click();
	await expect(page.locator("#pollArea")).toHaveText("모일 곳 · 시청역");
	const checks = page.locator(".vote-check");
	await expect(checks).toHaveCount(3);
	await expect(checks.nth(0).locator(".vote-check-place strong")).toHaveText("인기백반");
	await expect(checks.nth(0).locator(".vote-check-place")).toContainText("도보 약 14분 · 700m");
	await expect(checks.nth(0).locator(".vote-check-place")).toContainText("서울 중구 세종대로 110");
	await expect(checks.nth(0).locator(".vote-map-link")).toHaveAttribute("href", /^https:\/\/map\.kakao\.com\/link\/map\//);
	await expect(checks.nth(1).locator(".vote-check-place strong")).toHaveText("가까운돈까스");
	await expect(checks.nth(1).locator(".vote-check-place")).toContainText("도보 약 2분 · 100m");
	await expect(checks.nth(2).locator(".vote-check-place")).toHaveCount(0);

	// 지도 링크·가게 이름(가게 페이지 링크)을 눌러도 체크 상자는 그대로고, 식당 칸의 다른 곳을 누르면 고르기가 돼요
	const popup = page.waitForEvent("popup");
	await checks.nth(0).locator(".vote-map-link").click();
	await (await popup).close();
	const firstCheck = page.getByRole("checkbox", { name: "백반", exact: true });
	await expect(firstCheck).not.toBeChecked();
	const namePopup = page.waitForEvent("popup");
	await checks.nth(0).locator(".vote-check-place .place-name-link").click();
	// 가게 페이지 주소를 찾기 전에 창을 닫으면 본 화면이 그 주소로 이동해서, 주소가 들어간 뒤 닫아요.
	const namePage = await namePopup;
	await namePage.waitForURL(/place\.map\.kakao\.com|search\.naver\.com/).catch(() => {});
	await namePage.close();
	await expect(firstCheck).not.toBeChecked();
	await checks.nth(0).locator(".vote-check-place > span").first().click();
	await expect(firstCheck).toBeChecked();

	// 결과 줄에도 식당 이름이 붙고, 공유 글에는 '메뉴 · 식당'으로 들어가요
	await page.getByRole("checkbox", { name: "돈까스", exact: true }).check();
	await page.getByRole("button", { name: "보내기" }).click();
	const results = page.locator(".vote-result");
	await expect(results.nth(0).locator(".vote-option-name")).toHaveText("백반");
	await expect(results.nth(0).locator(".vote-option-restaurant")).toHaveText("인기백반");
	await expect(results.nth(2).locator(".vote-option-restaurant")).toHaveCount(0);
	await page.getByRole("button", { name: "링크 공유하기" }).click();
	await expect(page.getByRole("button", { name: "복사했어요" })).toBeVisible();
	expect(await page.evaluate(() => window.__shared)).toContain("후보: 백반 · 인기백반, 돈까스 · 가까운돈까스, 쌀국수 (모일 곳: 시청역)");

	// 방장이 식당 있는 후보로 정하면 식당 상자가 바로 보이고 '근처 식당 보기'는 글자 단추
	await page.getByRole("button", { name: "이걸로 정하기" }).first().click();
	await expect(page.locator("#confirmedName")).toHaveText("백반");
	const card = page.locator("#confirmedRestaurant .restaurant-card");
	await expect(card.locator(".restaurant-name .place-name-link")).toHaveText("인기백반");
	await expect(card.locator(".restaurant-walk")).toHaveText("도보 약 14분 · 700m");
	await expect(card.getByRole("link", { name: "카카오맵 길찾기 ↗" })).toBeVisible();
	await expect(card.locator(".report-button")).toHaveCount(0);
	const go = page.getByRole("link", { name: "근처 식당 보기" });
	await expect(go).toHaveClass(/text-button/);
	await expect(go).toHaveAttribute("href", /menu=%EB%B0%B1%EB%B0%98/);
});

test("모일 곳이 없으면 식당을 붙일 수 없고, 모양이 어긋난 restaurant 은 무시한다", async ({ page }) => {
	await page.goto("/vote.html?" + new URLSearchParams({ menus: "백반,돈까스", restaurant: JSON.stringify({ name: "좌표 없는 가게" }) }));
	await expect(page.locator(".vote-candidate")).toHaveCount(2);
	await expect(page.locator(".vote-candidate-restaurant")).toHaveCount(0);
	await page.getByRole("button", { name: "백반 식당 붙이기" }).click();
	await expect(page.locator("#createMessage")).toHaveText("모일 곳을 먼저 정해 주세요.");
	await expect(page.locator("#restaurantPicker")).toBeHidden();

	await page.goto("/vote.html?menus=백반,돈까스&restaurant=%7Bnot-json");
	await expect(page.locator(".vote-candidate")).toHaveCount(2);
	await expect(page.locator(".vote-candidate-restaurant")).toHaveCount(0);
});

test("식당 칸이 없는 옛 투표는 식당 없이 그대로 보인다", async ({ page }) => {
	await page.goto("/vote.html");
	const ids = await page.evaluate(() => {
		const base = { options: ["백반", "돈까스"], area: { label: "시청역", lat: 37.5665, lng: 126.978 }, host_token: "host", responses: {}, expires_at: new Date(Date.now() + 86400000).toISOString() };
		const open = "11111111-1111-4111-8111-111111111111";
		const done = "22222222-2222-4222-8222-222222222222";
		localStorage.setItem("__fakepolls", JSON.stringify({ [open]: { ...base, confirmed_index: null }, [done]: { ...base, confirmed_index: 0, responses: { me: [0] } } }));
		localStorage.setItem("omechu.pollHost." + done, "host");
		return { open, done };
	});
	await page.goto("/vote.html?id=" + ids.open);
	await expect(page.locator(".vote-check")).toHaveCount(2);
	await expect(page.locator(".vote-check-name")).toHaveText(["백반", "돈까스"]);
	await expect(page.locator(".vote-check-place")).toHaveCount(0);

	await page.goto("/vote.html?id=" + ids.done);
	await expect(page.locator("#confirmedName")).toHaveText("백반");
	await expect(page.locator(".restaurant-card")).toHaveCount(0);
	await expect(page.getByRole("link", { name: "근처 식당 보기" })).toHaveClass(/primary/);
});
