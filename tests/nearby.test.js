import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { loadPage, freshImport, settle } from "./helpers/dom.js";
import { KakaoStatus, kakaoPlace, useFakeKakao } from "./helpers/fake-kakao.js";
import { useFakeRpc, useNoSupabase } from "./helpers/fake-supabase.js";
import { useFakeGoogleNearby } from "./helpers/fake-google-nearby.js";

// initNearby 는 index.html 의 위치 칸·결과 칸을 쓰고, 모듈 전역에 위치 찾기 창(picker)을 한 번만 만들어 둬서
// 시험마다 화면을 새로 넣고 모듈도 새로 불러와요.
const kimchiStew = {
	name: "김치찌개",
	kinds: ["식사"],
	cuisine: "한식",
	search_terms: ["김치찌개", "찌개"],
	broad_terms: ["찌개"],
	broad_categories: ["한식/국/탕/찌개류"],
};
const tonkatsu = { name: "돈가스", kinds: ["식사"], cuisine: "일식", search_terms: ["돈가스", "돈까스"] };
const here = { lat: 37.5, lng: 127 };

// 가게는 출발지에서 북쪽으로 distance 미터에 둬요. DB 결과 줄 모양이에요.
function row(name, distance, extra = {}) {
	return { name, amenity: "restaurant", shop: null, lat: here.lat + distance / 111000, lng: here.lng, distance, phone: null, address: null, matched: true, official_visits: 0, category: null, ...extra };
}

// 반경마다 { menu, filters } 로 nearby_places 결과를 돌려줘요. 같은 반경에서 첫 부름은 추천 메뉴, 둘째 부름은 조건 메뉴예요.
function places(byRadius) {
	return useFakeRpc((params, call) => {
		const found = byRadius[params.p_radius]?.[call % 2 === 0 ? "menu" : "filters"];
		if (found instanceof Error) {
			return { data: null, error: found };
		}
		return { data: found ?? [], error: null };
	});
}

const navigatorBackup = {};
function setNavigator(key, value) {
	if (!(key in navigatorBackup)) {
		navigatorBackup[key] = Object.getOwnPropertyDescriptor(navigator, key);
	}
	Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
}

let permission;
let position;
let geocoded;
let fetchSpy;
let warn;
let restoreGoogle;
let random;

function allowLocation(state = "granted") {
	permission = state;
}

beforeEach(async () => {
	await loadPage("index.html");
	localStorage.clear();
	useNoSupabase();
	permission = "prompt";
	position = { coords: { latitude: here.lat, longitude: here.lng } };
	geocoded = [{ lat: String(here.lat), lon: String(here.lng) }];
	setNavigator("permissions", { query: async () => ({ state: permission }) });
	setNavigator("geolocation", {
		getCurrentPosition(success, failure) {
			queueMicrotask(() => (position.code ? failure(position) : success(position)));
		},
	});
	window.isSecureContext = true;
	fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (url) => {
		if (String(url).startsWith("https://nominatim.openstreetmap.org/")) {
			return geocoded instanceof Error ? new Response("", { status: 503 }) : Response.json(geocoded);
		}
		throw new Error("시험에서 부르지 않은 주소: " + url);
	});
	useFakeKakao({ coord2Address: () => [[{ road_address: { address_name: "서울 중구 세종대로 110" } }], KakaoStatus.OK] });
	restoreGoogle = useFakeGoogleNearby();
	warn = spyOn(console, "warn").mockImplementation(() => {});
	random = spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
	fetchSpy.mockRestore();
	warn.mockRestore();
	random.mockRestore();
	restoreGoogle();
	delete window.isSecureContext;
	for (const [key, descriptor] of Object.entries(navigatorBackup)) {
		if (descriptor) {
			Object.defineProperty(navigator, key, descriptor);
		} else {
			delete navigator[key];
		}
		delete navigatorBackup[key];
	}
	localStorage.clear();
	document.getElementById("placePicker")?.close();
});

async function start() {
	const { initNearby } = await freshImport("js/nearby.js");
	return initNearby(document.getElementById("nearby"));
}

async function until(check) {
	for (let i = 0; i < 200; i += 1) {
		if (check()) {
			return;
		}
		await settle(1);
	}
	throw new Error("기다린 상태가 오지 않았어요: " + document.getElementById("nearbyResult").textContent);
}

const section = () => document.getElementById("nearby");
const result = () => document.getElementById("nearbyResult");
const input = () => document.getElementById("nearbyPlace");
const note = () => document.getElementById("nearbyPlaceNote");
const currentButton = () => document.getElementById("nearbyCurrentBtn");
const orderBox = () => document.getElementById("nearbyOrder");
const pickName = () => result().querySelector(".restaurant-card .place-name-link")?.textContent;
const notes = () => [...result().querySelectorAll(".nearby-note")].map((element) => element.textContent);
const message = () => result().querySelector(".nearby-message")?.textContent;

function typeAndEnter(text) {
	input().readOnly = false;
	input().value = text;
	input().dispatchEvent(new Event("input"));
	input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
}

describe("처음 열 때", () => {
	test("추천 기준은 기본이 평점이고, 이 기기에 '거리'를 골라 뒀으면 거리다", async () => {
		await start();
		expect(orderBox().querySelector("input:checked").value).toBe("rating");
		await loadPage("index.html");
		localStorage.setItem("omechu.recommendOrder", "distance");
		await start();
		expect(orderBox().querySelector("input:checked").value).toBe("distance");
	});

	test("저장 값이 이상하거나 저장소를 못 읽으면 평점이다", async () => {
		localStorage.setItem("omechu.recommendOrder", "nearest");
		await start();
		expect(orderBox().querySelector("input:checked").value).toBe("rating");
		await loadPage("index.html");
		const read = spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		try {
			await start();
		} finally {
			read.mockRestore();
		}
		expect(orderBox().querySelector("input:checked").value).toBe("rating");
	});
});

describe("show: 메뉴를 보여 줄 때", () => {
	test("위치 칸이 비었고 위치 권한도 없으면 찾지 않고 결과 칸을 비워 둔다", async () => {
		const calls = places({});
		const nearby = await start();
		nearby.show(kimchiStew, [kimchiStew]);
		await settle();
		expect(section().hidden).toBe(false);
		expect(result().children).toHaveLength(0);
		expect(orderBox().hidden).toBe(true);
		expect(calls).toEqual([]);
	});

	test("위치 권한을 이미 허용했으면 현재 위치로 찾아 추천 식당을 그리고, 주소를 위치 칸에 넣는다", async () => {
		allowLocation();
		places({ 2000: { menu: [row("김치찌개 본점", 300), row("김치찌개 분점", 600)] } });
		const nearby = await start();
		nearby.show(kimchiStew, [kimchiStew]);
		await until(() => pickName());
		await until(() => input().value);
		expect(pickName()).toBe("김치찌개 본점");
		expect(input().value).toBe("서울 중구 세종대로 110");
		expect(nearby.currentPick()).toMatchObject({ name: "김치찌개 본점", menuName: "김치찌개" });
		// 구글 평점을 쓰는 설정이라 추천 기준 칩을 보여 줘요.
		expect(orderBox().hidden).toBe(false);
		expect(result().querySelector(".others-title").textContent).toBe("'김치찌개' 파는 다른 가까운 곳");
		expect(result().querySelector(".nearby-footer").textContent).toContain("평점 © Google");
		expect(currentButton().disabled).toBe(false);
		// 같은 주소로 다시 찾으면 주소를 다시 찾지 않고 같은 좌표를 써요.
		expect(nearby.knownOrigin()).toEqual({ label: "서울 중구 세종대로 110", lat: here.lat, lng: here.lng });
	});

	test("navigator.permissions 가 없으면 권한이 없는 것으로 본다", async () => {
		setNavigator("permissions", undefined);
		const calls = places({});
		const nearby = await start();
		nearby.show(kimchiStew, [kimchiStew]);
		await settle();
		expect(calls).toEqual([]);
	});

	test("위치 칸에 적은 곳이 있으면 그곳을 지오코딩해서 찾는다", async () => {
		places({ 2000: { menu: [row("김치찌개 집", 100)] } });
		const nearby = await start();
		input().value = "강남역";
		nearby.show(kimchiStew, [kimchiStew]);
		await until(() => pickName());
		expect(String(fetchSpy.mock.calls[0][0])).toContain("q=" + encodeURIComponent("강남역"));
		expect(result().querySelector(".restaurant-links a").href).toContain("/link/from/" + encodeURIComponent("강남역") + ",");
	});

	test("찾는 동안 결과 칸에 하는 일을 보여 주고 현재 위치 단추를 꺼 둔다", async () => {
		let release;
		useFakeRpc(() => new Promise((resolve) => {
			release = () => resolve({ data: [], error: null });
		}));
		const nearby = await start();
		input().value = "강남역";
		nearby.show(kimchiStew, [kimchiStew]);
		await until(() => message() === "식당 찾는 중…");
		expect(currentButton().disabled).toBe(true);
		expect(nearby.currentPick()).toBeNull();
		release();
	});

	test("동네를 못 찾으면 그 안내와 구글 지도 링크를 보여 준다", async () => {
		geocoded = [];
		const nearby = await start();
		input().value = "없는동네";
		nearby.show(kimchiStew, [kimchiStew]);
		await until(() => message()?.includes("위치를 찾지"));
		expect(message()).toBe("'없는동네' 위치를 찾지 못했어요. 역 이름이나 동 이름으로 적어 주세요.");
		expect([...result().querySelectorAll(".nearby-footer a")].at(-1).href).toBe("https://www.google.com/maps/search/" + encodeURIComponent("없는동네 김치찌개"));
		expect(orderBox().hidden).toBe(true);
		expect(nearby.currentPick()).toBeNull();
	});

	test("2km·5km 안에 아무 가게도 없으면 5km 안에서 못 찾았다고 한다", async () => {
		places({});
		const nearby = await start();
		input().value = "강남역";
		nearby.show(kimchiStew, [kimchiStew]);
		await until(() => message()?.includes("찾지 못했어요"));
		expect(message()).toBe("강남역 근처 5km 안에서 조건에 맞는 식당을 찾지 못했어요.");
	});

	test("2km 안에 없어서 5km까지 찾았으면 그렇다고 알린다", async () => {
		places({ 5000: { menu: [row("김치찌개 먼집", 4000)] } });
		const nearby = await start();
		input().value = "강남역";
		nearby.show(kimchiStew, [kimchiStew]);
		await until(() => pickName());
		expect(notes()).toEqual(["2km 안에 맞는 가게가 없어서 5km까지 찾았어요."]);
	});

	test("메뉴 가게가 없어 같은 조건의 다른 메뉴 가게를 고르면 그렇다고 알린다", async () => {
		places({ 2000: { filters: [row("돈가스 집", 200)] } });
		const nearby = await start();
		input().value = "강남역";
		nearby.show(kimchiStew, [kimchiStew, tonkatsu]);
		await until(() => pickName());
		expect(pickName()).toBe("돈가스 집");
		expect(notes()).toEqual(["'김치찌개' 파는 곳은 못 찾아서, 같은 조건의 '돈가스' 가게를 골랐어요."]);
	});

	test("넓은 말로만 맞는 가게를 고르면 받침에 맞춰 '이/가'를 붙여 알린다", async () => {
		places({ 2000: { menu: [row("동네 찌개집", 200)] } });
		const nearby = await start();
		input().value = "강남역";
		nearby.show(kimchiStew, [kimchiStew]);
		await until(() => pickName());
		expect(notes()).toEqual(["'김치찌개'가 주력인 가게는 못 찾아서, 이름에 '찌개'가 들어간 가게를 골랐어요."]);
		expect(result().querySelector(".others")).toBeNull();
	});

	test("넓은 업종으로만 맞으면 업종 이름으로 알리고, 받침 있는 메뉴에는 '이'를 붙인다", async () => {
		const gukbap = { name: "순댓국", kinds: ["식사"], cuisine: "한식", search_terms: ["순댓국"], broad_categories: ["한식/국/탕/찌개류"] };
		places({ 2000: { menu: [row("시골집", 200, { category: "한식/국/탕/찌개류" })] } });
		const nearby = await start();
		input().value = "강남역";
		nearby.show(gukbap, [gukbap]);
		await until(() => pickName());
		expect(notes()[0]).toStartWith("'순댓국'이 주력인 가게는 못 찾아서, '");
		expect(notes()[0]).toEndWith("' 가게를 골랐어요.");
	});

	test("비슷한 가게(같은 종류 식당)를 고르면 그 종류로 알린다", async () => {
		places({ 2000: { menu: [row("어느 한식당", 200, { matched: false }), row("다른 한식당", 400, { matched: false })] } });
		const nearby = await start();
		input().value = "강남역";
		nearby.show(kimchiStew, [kimchiStew]);
		await until(() => pickName());
		expect(notes()).toEqual(["조건에 맞는 가게를 못 찾아서, 근처 한식당을 골랐어요."]);
		expect(result().querySelector(".others-title").textContent).toBe("다른 가까운 곳");
	});

	test("메뉴 가게가 한 곳뿐이면 다른 가까운 곳은 조건에 맞는 다른 메뉴 가게다", async () => {
		places({ 2000: { menu: [row("김치찌개 집", 100)], filters: [row("김치찌개 집", 100), row("돈가스 집", 300)] } });
		const nearby = await start();
		input().value = "강남역";
		nearby.show(kimchiStew, [kimchiStew, tonkatsu]);
		await until(() => pickName());
		expect(result().querySelector(".others-title").textContent).toBe("조건에 맞는 다른 가까운 곳");
	});

	test("다른 가게가 없으면 추천 상자에 경고 단추를 두고 목록은 그리지 않는다", async () => {
		places({ 2000: { menu: [row("김치찌개 집", 100)] } });
		const nearby = await start();
		input().value = "강남역";
		nearby.show(kimchiStew, [kimchiStew]);
		await until(() => pickName());
		expect(result().querySelector(".restaurant-card .report-button")).not.toBeNull();
		expect(result().querySelector(".others")).toBeNull();
	});
});

describe("'다른 가게'", () => {
	test("보여 준 가게를 빼고 다시 고르고, 다 돌면 처음부터 다시 고른다", async () => {
		places({ 2000: { menu: [row("김치찌개 A", 100), row("김치찌개 B", 200)] } });
		const nearby = await start();
		input().value = "강남역";
		nearby.show(kimchiStew, [kimchiStew]);
		await until(() => pickName());
		const seen = [pickName()];
		for (let i = 0; i < 2; i += 1) {
			result().querySelector(".another-button").click();
			await until(() => pickName() && result().querySelector(".another-button:not([disabled])"));
			seen.push(pickName());
		}
		expect(seen).toEqual(["김치찌개 A", "김치찌개 B", "김치찌개 A"]);
		// 위치는 다시 찾지 않아요.
		expect(fetchSpy.mock.calls).toHaveLength(1);
	});

	test("메뉴를 새로 보여 주면 보여 준 가게 기억을 비운다", async () => {
		places({ 2000: { menu: [row("김치찌개 A", 100), row("김치찌개 B", 200)] } });
		const nearby = await start();
		input().value = "강남역";
		nearby.show(kimchiStew, [kimchiStew]);
		await until(() => pickName());
		result().querySelector(".another-button").click();
		await until(() => pickName() === "김치찌개 B");
		nearby.show(kimchiStew, [kimchiStew]);
		await until(() => pickName());
		expect(pickName()).toBe("김치찌개 A");
	});
});

describe("추천 기준 바꾸기", () => {
	test("고른 기준을 이 기기에 기억하고, 찾은 곳이 있으면 같은 위치에서 다시 고른다", async () => {
		places({ 2000: { menu: [row("김치찌개 집", 100)] } });
		const nearby = await start();
		input().value = "강남역";
		nearby.show(kimchiStew, [kimchiStew]);
		await until(() => pickName());
		const distance = orderBox().querySelector("input[value='distance']");
		distance.checked = true;
		orderBox().dispatchEvent(new Event("change"));
		expect(localStorage.getItem("omechu.recommendOrder")).toBe("distance");
		await until(() => message() === "식당 찾는 중…" || message() === "위치 찾는 중…");
		await until(() => pickName());
		expect(fetchSpy.mock.calls).toHaveLength(1);
	});

	test("아직 찾은 곳이 없으면 기억만 하고 찾지 않는다", async () => {
		const calls = places({});
		await start();
		orderBox().querySelector("input[value='distance']").checked = true;
		orderBox().dispatchEvent(new Event("change"));
		await settle();
		expect(localStorage.getItem("omechu.recommendOrder")).toBe("distance");
		expect(calls).toEqual([]);
	});

	test("저장이 막혀도 오류 없이 넘어간다", async () => {
		await start();
		const write = spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		try {
			orderBox().querySelector("input[value='distance']").checked = true;
			expect(() => orderBox().dispatchEvent(new Event("change"))).not.toThrow();
		} finally {
			write.mockRestore();
		}
	});
});

describe("showSearch: 가게·메뉴 검색 목록", () => {
	test("찾은 가게를 가까운 순 목록으로 보여 주고, 추천 식당은 없다", async () => {
		places({ 2000: { menu: [row("김밥천국 시청점", 300), row("김밥천국 을지로점", 100)] } });
		const nearby = await start();
		input().value = "강남역";
		nearby.showSearch("김밥천국", []);
		await until(() => result().querySelector(".others"));
		expect(result().querySelector(".others-title").textContent).toBe("강남역 근처 '김밥천국' 2곳");
		expect([...result().querySelectorAll(".others .place-name-link")].map((link) => link.textContent)).toEqual(["김밥천국 을지로점", "김밥천국 시청점"]);
		expect(result().querySelector(".restaurant-card")).toBeNull();
		expect(nearby.currentPick()).toBeNull();
		expect(orderBox().hidden).toBe(true);
	});

	test("5km까지 넓혀 찾았으면 그렇다고 알린다", async () => {
		places({ 5000: { menu: [row("김밥천국", 3000)] } });
		const nearby = await start();
		input().value = "강남역";
		nearby.showSearch("김밥천국", []);
		await until(() => result().querySelector(".others"));
		expect(notes()).toEqual(["2km 안에 맞는 가게가 없어서 5km까지 찾았어요."]);
	});

	test("못 찾으면 찾은 거리와 함께 안내하고, 구글 지도 링크는 좌표로 찾는다", async () => {
		places({});
		const nearby = await start();
		input().value = "강남역";
		nearby.showSearch("없는가게", []);
		await until(() => message()?.includes("찾지 못했어요"));
		expect(message()).toBe("강남역 근처 5km 안에서 '없는가게' 가게를 찾지 못했어요.");
		expect([...result().querySelectorAll(".nearby-footer a")].at(-1).href).toContain("/@37.500000,127.000000,16z");
	});

	test("DB 오류면 그 안내를 보여 준다", async () => {
		places({ 2000: { menu: new Error("db down") } });
		const nearby = await start();
		input().value = "강남역";
		nearby.showSearch("김밥", []);
		await until(() => message()?.includes("못했어요"));
		expect(message()).toBe("가게를 찾지 못했어요. 잠시 후 다시 찾아 주세요.");
	});
});

describe("hide", () => {
	test("결과 칸을 숨기고, 숨긴 뒤 늦게 끝난 검색은 그리지 않는다", async () => {
		let release;
		useFakeRpc(() => new Promise((resolve) => {
			release = () => resolve({ data: [row("김치찌개 집", 100)], error: null });
		}));
		const nearby = await start();
		input().value = "강남역";
		nearby.show(kimchiStew, [kimchiStew]);
		await until(() => release);
		nearby.hide();
		release();
		await settle(20);
		expect(section().hidden).toBe(true);
		expect(pickName()).toBeUndefined();
		expect(nearby.currentPick()).toBeNull();
	});
});

describe("위치 칸", () => {
	test("읽기 전용 칸을 누르면 장소 창을 열고, 고른 곳으로 바로 찾는다", async () => {
		useFakeKakao({
			keywordSearch: () => [[kakaoPlace("시청역", { x: String(here.lng), y: String(here.lat) })], KakaoStatus.OK],
			coord2Address: () => [[], KakaoStatus.ZERO_RESULT],
		});
		places({ 2000: { menu: [row("김치찌개 집", 100)] } });
		const nearby = await start();
		nearby.show(kimchiStew, [kimchiStew]);
		await settle();
		input().value = "시청";
		input().click();
		const dialog = document.getElementById("placePicker");
		await until(() => dialog.querySelector(".place-picker-results button"));
		dialog.querySelector(".place-picker-results button").click();
		await until(() => pickName());
		expect(input().value).toBe("시청역");
		// 고른 곳의 좌표를 그대로 써서 지오코딩하지 않아요.
		expect(fetchSpy.mock.calls).toHaveLength(0);
		expect(nearby.knownOrigin()).toEqual({ label: "시청역", lat: here.lat, lng: here.lng });
	});

	test("메뉴를 보여 주기 전에 고르면 위치만 기억한다", async () => {
		useFakeKakao({ keywordSearch: () => [[kakaoPlace("시청역")], KakaoStatus.OK] });
		const calls = places({});
		await start();
		input().value = "시청";
		input().click();
		const dialog = document.getElementById("placePicker");
		await until(() => dialog.querySelector(".place-picker-results button"));
		dialog.querySelector(".place-picker-results button").click();
		await settle();
		expect(input().value).toBe("시청역");
		expect(calls).toEqual([]);
	});

	test("장소 창이 카카오를 못 써서 실패하고 닫히면 위치 칸에 직접 적는 방식으로 바꾼다", async () => {
		useFakeKakao({ keywordSearch: () => [[], KakaoStatus.ERROR] });
		await start();
		input().value = "역";
		input().click();
		const dialog = document.getElementById("placePicker");
		await until(() => dialog.querySelector(".place-picker-message").textContent.includes("안 돼요"));
		dialog.close();
		await settle();
		expect(input().readOnly).toBe(false);
		expect(document.activeElement).toBe(input());
	});

	test("그냥 닫으면 아무것도 바꾸지 않는다", async () => {
		useFakeKakao({ keywordSearch: () => [[kakaoPlace("시청역")], KakaoStatus.OK] });
		await start();
		input().click();
		document.getElementById("placePicker").close();
		await settle();
		expect(input().value).toBe("");
		expect(input().readOnly).toBe(true);
	});

	test("직접 적는 방식에서 Enter 를 치면 그곳으로 찾고, 빈 칸이면 동네를 적으라고 한다", async () => {
		places({ 2000: { menu: [row("김치찌개 집", 100)] } });
		const nearby = await start();
		nearby.show(kimchiStew, [kimchiStew]);
		await settle();
		typeAndEnter("   ");
		expect(message()).toBe("동네나 역 이름을 입력해 주세요.");
		expect(document.activeElement).toBe(input());
		typeAndEnter("강남역");
		await until(() => pickName());
		expect(pickName()).toBe("김치찌개 집");
	});

	test("메뉴를 보여 주기 전이면 Enter 를 쳐도 찾지 않고, Enter 말고 다른 키는 무시한다", async () => {
		const calls = places({});
		await start();
		typeAndEnter("강남역");
		input().dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
		await settle();
		expect(calls).toEqual([]);
		expect(fetchSpy.mock.calls).toHaveLength(0);
	});

	test("위치 칸 글자를 바꾸면, 다음에 메뉴를 보여 줄 때 새로 적은 곳을 찾는다", async () => {
		places({ 2000: { menu: [row("김치찌개 집", 100)] } });
		const nearby = await start();
		nearby.show(kimchiStew, [kimchiStew]);
		await settle();
		typeAndEnter("강남역");
		await until(() => pickName());
		input().value = "역삼역";
		input().dispatchEvent(new Event("input"));
		nearby.show(kimchiStew, [kimchiStew]);
		await until(() => fetchSpy.mock.calls.length === 2);
		expect(String(fetchSpy.mock.calls[1][0])).toContain("q=" + encodeURIComponent("역삼역"));
	});
});

describe("현재 위치 단추", () => {
	test("메뉴를 보여 주기 전에 누르면 위치만 잡아 주소를 칸에 넣는다", async () => {
		const calls = places({});
		const nearby = await start();
		currentButton().click();
		expect(currentButton().disabled).toBe(true);
		await until(() => input().value);
		expect(input().value).toBe("서울 중구 세종대로 110");
		expect(currentButton().disabled).toBe(false);
		expect(calls).toEqual([]);
		expect(nearby.knownOrigin()).toEqual({ label: "서울 중구 세종대로 110", lat: here.lat, lng: here.lng });
	});

	test("주소를 못 찾으면 '현재 위치'를 칸에 넣고, 그 좌표를 다음 추천에 쓴다", async () => {
		useFakeKakao({ coord2Address: () => [[], KakaoStatus.ZERO_RESULT] });
		places({ 2000: { menu: [row("김치찌개 집", 100)] } });
		const nearby = await start();
		currentButton().click();
		await until(() => input().value);
		expect(input().value).toBe("현재 위치");
		nearby.show(kimchiStew, [kimchiStew]);
		await until(() => pickName());
		expect(fetchSpy.mock.calls).toHaveLength(0);
		expect(result().querySelector(".restaurant-links a").href).toContain("/link/from/" + encodeURIComponent("현재 위치") + ",");
	});

	test("위치 권한이 꺼져 있으면 칸 아래에 안내를 보여 준다", async () => {
		position = { code: 1 };
		await start();
		currentButton().click();
		await until(() => !note().hidden);
		expect(note().textContent).toStartWith("위치 권한이 꺼져 있어요.");
		expect(currentButton().disabled).toBe(false);
	});

	test("https 가 아니면 현재 위치를 쓸 수 없다고 안내한다", async () => {
		window.isSecureContext = false;
		await start();
		currentButton().click();
		await until(() => !note().hidden);
		expect(note().textContent).toStartWith("현재 위치는 https 주소나 localhost 에서만 쓸 수 있어요.");
	});

	test("메뉴를 보여 준 뒤 누르면 현재 위치로 바로 찾는다", async () => {
		places({ 2000: { menu: [row("김치찌개 집", 100)] } });
		const nearby = await start();
		nearby.show(kimchiStew, [kimchiStew]);
		await settle();
		currentButton().click();
		await until(() => pickName());
		expect(fetchSpy.mock.calls).toHaveLength(0);
	});

	test("현재 위치를 못 잡으면 결과 칸에 그 안내를 보여 준다", async () => {
		position = { code: 3 };
		const nearby = await start();
		nearby.show(kimchiStew, [kimchiStew]);
		await settle();
		currentButton().click();
		await until(() => message()?.includes("오래 걸려요"));
		expect(currentButton().disabled).toBe(false);
	});
});

describe("setOrigin·knownOrigin", () => {
	test("같이 정하기에서 정한 곳을 칸에 넣고 그 좌표로 찾는다", async () => {
		places({ 2000: { menu: [row("김치찌개 집", 100)] } });
		const nearby = await start();
		nearby.setOrigin({ label: "모일 곳", lat: here.lat, lng: here.lng });
		expect(input().value).toBe("모일 곳");
		expect(nearby.knownOrigin()).toEqual({ label: "모일 곳", lat: here.lat, lng: here.lng });
		nearby.show(kimchiStew, [kimchiStew]);
		await until(() => pickName());
		expect(fetchSpy.mock.calls).toHaveLength(0);
	});

	test("칸 글자가 기억한 곳과 다르거나 비었으면 좌표를 모른다(null)", async () => {
		const nearby = await start();
		expect(nearby.knownOrigin()).toBeNull();
		nearby.setOrigin({ label: "모일 곳", lat: 1, lng: 2 });
		input().value = "다른 곳";
		expect(nearby.knownOrigin()).toBeNull();
		input().value = "  ";
		expect(nearby.knownOrigin()).toBeNull();
	});
});
