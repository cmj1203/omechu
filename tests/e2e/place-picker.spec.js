// 위치 찾기 창(js/place-picker.js)의 회귀 시험.
// 카카오 SDK 를 이 파일 안의 가짜로 바꿔 끼워서, 장소 검색 응답이 언제·무엇으로 오는지 시험에서 정해요.
// keywordSearch 를 부르면 콜백을 window.__kakaoPending 에 쌓아 두고, 시험이 answer() 로 골라서 돌려줘요.
import { expect, test } from "./fixtures.js";

const controlledKakao = `(() => {
	function LatLng(y, x) { this.y = y; this.x = x; }
	window.__kakaoPending = [];
	window.kakao = { maps: {
		load: (callback) => callback(),
		LatLng,
		LatLngBounds: function () { this.extend = () => {}; },
		Map: function () { this.relayout = () => {}; this.setBounds = () => {}; },
		CustomOverlay: function () { this.setMap = () => {}; },
		services: {
			Status: { OK: "OK", ZERO_RESULT: "ZERO_RESULT", ERROR: "ERROR" },
			SortBy: { DISTANCE: "distance" },
			Geocoder: function () { this.coord2Address = () => {}; },
			Places: function () {
				this.keywordSearch = (query, callback) => window.__kakaoPending.push({ query, callback });
			},
		},
	} };
})();`;

const GANGNAM = {
	place_name: "강남역 2호선", road_address_name: "서울 강남구 강남대로 396", address_name: "서울 강남구 역삼동 858",
	x: "127.0276", y: "37.4979", place_url: "http://place.map.kakao.com/1",
};

// 쌓인 검색 중 index 번째에 status 로 답해요. OK 면 강남역 하나를 돌려줘요.
async function answer(page, index, status) {
	await page.evaluate(([i, s, place]) => {
		const { callback } = window.__kakaoPending[i];
		callback(s === "OK" ? [place] : [], s);
	}, [index, status, GANGNAM]);
}

async function pendingCount(page) {
	return page.evaluate(() => window.__kakaoPending.length);
}

test.beforeEach(async ({ page }) => {
	// page 의 route 가 fixtures.js 의 context route 보다 먼저 걸려요.
	await page.route("https://dapi.kakao.com/**", (route) =>
		route.fulfill({ contentType: "text/javascript; charset=utf-8", body: controlledKakao }));
});

test("창을 닫은 뒤 늦게 온 검색 결과는 목록·지도에 넣지 않는다", async ({ page }) => {
	await page.goto("/index.html");
	const place = page.locator("#nearbyPlace");
	const dialog = page.locator("#placePicker");
	const results = page.locator(".place-picker-results li");

	await place.click();
	await page.locator(".place-picker-form input").fill("강남역");
	await page.locator(".place-picker-form button").click();
	await expect.poll(() => pendingCount(page)).toBe(1);
	await expect(page.locator(".place-picker-message")).toHaveText("찾는 중…");

	await page.locator(".place-picker-close").click();
	await expect(dialog).toBeHidden();

	await answer(page, 0, "OK");
	await expect(results).toHaveCount(0);
	await expect(page.locator(".place-picker-map")).toBeHidden();
	await expect(place).toHaveValue("");

	// 다시 열어도 앞서 늦게 온 결과가 남아 있지 않고, 새로 찾은 결과만 보여요.
	await place.click();
	await expect(dialog).toBeVisible();
	await expect(results).toHaveCount(0);
	await page.locator(".place-picker-form input").fill("강남역");
	await page.locator(".place-picker-form button").click();
	await expect.poll(() => pendingCount(page)).toBe(2);
	await answer(page, 1, "OK");
	await expect(results).toHaveCount(1);
	await results.locator("button").click();
	await expect(place).toHaveValue("강남역 2호선");
});

test("검색이 한 번 실패해도 다시 찾아 성공하면 위치 칸을 직접 적기로 바꾸지 않는다", async ({ page }) => {
	await page.goto("/index.html");
	const place = page.locator("#nearbyPlace");
	const message = page.locator(".place-picker-message");

	await place.click();
	await page.locator(".place-picker-form input").fill("강남역");
	await page.locator(".place-picker-form button").click();
	await expect.poll(() => pendingCount(page)).toBe(1);
	await answer(page, 0, "ERROR");
	await expect(message).toContainText("카카오 장소 검색이 안 돼요");

	await page.locator(".place-picker-form button").click();
	await expect.poll(() => pendingCount(page)).toBe(2);
	await answer(page, 1, "OK");
	await expect(message).toBeHidden();
	await expect(page.locator(".place-picker-results li")).toHaveCount(1);

	// 고르지 않고 닫아도, 마지막 검색이 성공했으니 위치 칸은 그대로 검색 창을 여는 칸이에요.
	await page.locator(".place-picker-close").click();
	await expect(page.locator("#placePicker")).toBeHidden();
	await expect(place).toHaveJSProperty("readOnly", true);
});

test("검색이 실패한 채로 닫으면 위치 칸에 직접 적게 바뀐다", async ({ page }) => {
	await page.goto("/index.html");
	const place = page.locator("#nearbyPlace");

	await place.click();
	await page.locator(".place-picker-form input").fill("강남역");
	await page.locator(".place-picker-form button").click();
	await expect.poll(() => pendingCount(page)).toBe(1);
	await answer(page, 0, "ERROR");
	await expect(page.locator(".place-picker-message")).toContainText("카카오 장소 검색이 안 돼요");

	await page.locator(".place-picker-close").click();
	await expect(place).toHaveJSProperty("readOnly", false);
	await expect(place).toBeFocused();
});
