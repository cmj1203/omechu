import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { freshImport, loadPage, settle } from "./helpers/dom.js";
import { KakaoStatus, kakaoPlace, useFakeKakao } from "./helpers/fake-kakao.js";
import { useFakeSupabase, useNoSupabase } from "./helpers/fake-supabase.js";
import { placeKey } from "../js/nearby-restaurant-search.js";

// js/vote.js 는 불러올 때 바로 도는 화면 모듈이라, 시험마다 vote.html 을 새로 넣고 모듈을 새로 불러와요.
// 10초마다 다시 읽는 setInterval 은 실제로 걸지 않고 콜백만 모아 두어, 시험에서 직접 불러요.

const POLL_ID = "11111111-2222-4333-8444-555555555555";
const AREA = { label: "시청역", lat: 37.5665, lng: 126.978 };
const HOUR = 3_600_000;
const kimchiStew = { name: "김치찌개", kinds: ["식사"], cuisine: "한식", search_terms: ["김치찌개"], exclude_terms: [], broad_terms: [], categories: [], broad_categories: [] };

const $ = (id) => document.getElementById(id);

let intervals;
let originals;
let errorSpy;
let warnSpy;

function pollState(overrides = {}) {
	return {
		options: ["김치찌개", "돈가스"],
		area: AREA,
		expires_at: new Date(Date.now() + 2 * HOUR + 60_000).toISOString(),
		confirmed_index: null,
		mine: null,
		counts: null,
		responders: 0,
		common: [],
		is_host: false,
		restaurants: null,
		...overrides,
	};
}

// supabase 설정과 주소로 vote.js 를 새로 실행해요. 돌려주는 calls 에 RPC·표 부름이 쌓여요.
async function start(search, supabase = {}) {
	const calls = useFakeSupabase(supabase);
	await loadPage("vote.html", search);
	await freshImport("js/vote.js");
	await settle();
	return calls;
}

function rpcCalls(calls, name) {
	return calls.filter((call) => call.rpc === name);
}

const visible = (id) => !$(id).hidden;
const chipNames = () => [...$("optionChips").querySelectorAll(".vote-candidate-name")].map((node) => node.textContent);

function setGlobal(target, key, value) {
	originals.push([target, key, Object.getOwnPropertyDescriptor(target, key)]);
	Object.defineProperty(target, key, { configurable: true, writable: true, value });
}

function fakeFetch(respond) {
	const urls = [];
	setGlobal(globalThis, "fetch", async (url) => {
		urls.push(String(url));
		return respond(String(url));
	});
	return urls;
}

// 기본 메뉴 파일(data/menus.json)은 빈 목록으로, 나머지(동네 좌표 찾기)는 geocode(url) 로 답해요.
function fakeFetchWithMenus(geocode) {
	return fakeFetch((url) => (url.includes("menus.json") ? { ok: true, status: 200, json: async () => [] } : geocode(url)));
}

function geocodeAnswer(lat = "37.1", lon = "127.1") {
	return { ok: true, status: 200, json: async () => [{ lat, lon }] };
}

function dbRow(name, distance, extra = {}) {
	return { name, amenity: "restaurant", shop: null, lat: 37.5665 + distance / 111000, lng: 126.978, distance, phone: "", address: "서울 중구", matched: true, official_visits: 0, category: null, ...extra };
}

// 구글 지도 SDK 스크립트를 붙이면 가짜 구글로 바로 준비됐다고 알려요(평점은 늘 못 찾은 것으로).
let googleObserver;
beforeAll(() => {
	googleObserver = new MutationObserver(() => {
		for (const script of document.head.querySelectorAll("script[src*='maps.googleapis.com']")) {
			if (script.dataset.fakeReady) {
				continue;
			}
			script.dataset.fakeReady = "1";
			window.google ??= { maps: { importLibrary: async () => ({ Place: { searchByText: async () => ({ places: [] }) } }) } };
			window.omechuGoogleMapsReady?.();
		}
	});
	googleObserver.observe(document.head, { childList: true });
});

afterAll(() => {
	googleObserver.disconnect();
});

beforeEach(() => {
	intervals = [];
	originals = [];
	localStorage.clear();
	setGlobal(globalThis, "setInterval", (callback, ms) => {
		intervals.push({ callback, ms });
		return 900000 + intervals.length;
	});
	errorSpy = spyOn(console, "error").mockImplementation(() => {});
	warnSpy = spyOn(console, "warn").mockImplementation(() => {});
	useFakeKakao();
});

afterEach(() => {
	for (const [target, key, descriptor] of originals.reverse()) {
		if (descriptor) {
			Object.defineProperty(target, key, descriptor);
		} else {
			delete target[key];
		}
	}
	errorSpy.mockRestore();
	warnSpy.mockRestore();
	localStorage.clear();
});

describe("처음 화면: 주소의 후보·모일 곳·식당", () => {
	test("id 가 없으면 만들기 화면을 보여 준다", async () => {
		await start("");
		expect(visible("createView")).toBe(true);
		expect(visible("loadingView")).toBe(false);
		expect(chipNames()).toEqual([]);
		expect($("createMessage").textContent).toBe("후보를 2개 이상 넣어 주세요.");
		expect($("createButton").disabled).toBe(true);
	});

	test("menus 는 쉼표로 나누고, 앞뒤 공백·빈 칸·중복을 빼고, 30자로 자르고, 3개까지만 받는다", async () => {
		const long = "가".repeat(35);
		await start("?" + new URLSearchParams({ menus: " 라면 ,라면,, ," + long + ",우동,김밥" }));
		expect(chipNames()).toEqual(["라면", "가".repeat(30), "우동"]);
		expect($("optionCount").textContent).toBe("3");
		expect($("optionInput").disabled).toBe(true);
		expect($("addButton").disabled).toBe(true);
	});

	test("30자로 자른 뒤 같아지는 이름도 한 번만 넣는다", async () => {
		const base = "나".repeat(30);
		await start("?" + new URLSearchParams({ menus: base + "A," + base + "B" }));
		expect(chipNames()).toEqual([base]);
	});

	test("place 와 lat·lng 가 모두 오면 좌표가 있는 모일 곳으로 시작해 바로 만들 수 있다", async () => {
		await start("?menus=라면,우동&place=시청역&lat=37.5&lng=127");
		expect($("pollPlace").value).toBe("시청역");
		expect($("createButton").disabled).toBe(false);
		expect($("createMessage").textContent).toBe("");
	});

	test("place 는 60자로 자른다", async () => {
		await start("?menus=라면&place=" + "다".repeat(70));
		expect($("pollPlace").value).toBe("다".repeat(60));
	});

	test("후보가 2개인데 모일 곳이 없으면 모일 곳을 정하라고 한다", async () => {
		await start("?menus=라면,우동");
		expect($("createMessage").textContent).toBe("모일 곳을 정해 주세요.");
		expect($("createButton").disabled).toBe(true);
	});

	for (const [what, search] of [
		["lat 가 숫자가 아니면", "?menus=라면,우동&place=시청역&lat=abc&lng=127"],
		["lng 가 없으면", "?menus=라면,우동&place=시청역&lat=37.5"],
		["lat·lng 가 빈 글자면", "?menus=라면,우동&place=시청역&lat=&lng="],
	]) {
		test(what + " 이름만 있는 모일 곳으로 보고, 만들 때 좌표를 찾는다", async () => {
			const urls = fakeFetch(() => geocodeAnswer());
			const calls = await start(search, { rpc: { create_menu_poll: { data: [{ id: POLL_ID, host_token: "t" }], error: null }, menu_poll_state: { data: pollState(), error: null } } });
			$("createButton").click();
			await settle();
			expect(urls).toHaveLength(1);
			expect(new URL(urls[0]).searchParams.get("q")).toBe("시청역");
			expect(rpcCalls(calls, "create_menu_poll")[0].params).toMatchObject({ p_area_label: "시청역", p_area_lat: 37.1, p_area_lng: 127.1 });
		});
	}
});

describe("처음 식당(restaurant): 모양 맞추기", () => {
	// 첫 후보에 붙은 식당을 만들기 RPC 의 p_restaurants 로 확인해요.
	async function createdRestaurants(restaurant, menus = "라면,우동") {
		const calls = await start("?" + new URLSearchParams({ menus, place: AREA.label, lat: AREA.lat, lng: AREA.lng, restaurant }), {
			rpc: { create_menu_poll: { data: [{ id: POLL_ID, host_token: "t" }], error: null }, menu_poll_state: { data: pollState(), error: null } },
		});
		$("createButton").click();
		await settle();
		return rpcCalls(calls, "create_menu_poll")[0].params.p_restaurants;
	}

	test("맞는 식당은 첫 후보에만 붙고, 화면에 이름과 '식당 떼기'를 보여 준다", async () => {
		const restaurant = { key: "k1", name: "라면집", address: "서울 중구", phone: "02-1", lat: 37.56, lng: 126.97 };
		const calls = await start("?" + new URLSearchParams({ menus: "라면,우동", restaurant: JSON.stringify(restaurant) }));
		const rows = [...$("optionChips").querySelectorAll(".vote-candidate")];
		expect(rows[0].querySelector(".vote-candidate-restaurant").textContent).toBe("라면집");
		expect(rows[0].querySelector(".text-button").textContent).toBe("식당 떼기");
		expect(rows[0].querySelector(".text-button").getAttribute("aria-label")).toBe("라면 식당 떼기");
		expect(rows[1].querySelector(".vote-candidate-restaurant")).toBeNull();
		expect(rows[1].querySelector(".text-button").textContent).toBe("식당 붙이기");
		expect(calls).toEqual([]);
	});

	test("앞뒤 공백을 지우고 이름은 80자, 주소·전화는 200자로 자르며 빈 주소·전화는 null 이다", async () => {
		const [first, second] = await createdRestaurants(JSON.stringify({
			key: "k1",
			name: "  " + "가".repeat(90) + "  ",
			address: " " + "주".repeat(250),
			phone: "   ",
			lat: 37.56,
			lng: 126.97,
		}));
		expect(first).toEqual({ key: "k1", name: "가".repeat(80), address: "주".repeat(200), phone: null, lat: 37.56, lng: 126.97 });
		expect(second).toBeNull();
	});

	test("key 가 없거나 80자를 넘으면 이름·좌표로 만든 placeKey 를 쓴다", async () => {
		const base = { name: "라면집", lat: 37.56, lng: 126.97 };
		expect((await createdRestaurants(JSON.stringify(base)))[0].key).toBe(placeKey(base));
		expect((await createdRestaurants(JSON.stringify({ ...base, key: "k".repeat(81) })))[0].key).toBe(placeKey(base));
		expect((await createdRestaurants(JSON.stringify({ ...base, key: "k".repeat(80) })))[0].key).toBe("k".repeat(80));
		expect((await createdRestaurants(JSON.stringify({ ...base, key: "" })))[0].key).toBe(placeKey(base));
	});

	for (const [what, raw] of [
		["JSON 이 아니면", "{라면"],
		["배열이면", JSON.stringify([{ name: "라면집", lat: 37, lng: 127 }])],
		["null 이면", "null"],
		["이름이 없으면", JSON.stringify({ lat: 37, lng: 127 })],
		["이름이 공백뿐이면", JSON.stringify({ name: "  ", lat: 37, lng: 127 })],
		["이름이 글자가 아니면", JSON.stringify({ name: 3, lat: 37, lng: 127 })],
		["위도가 90을 넘으면", JSON.stringify({ name: "라면집", lat: 91, lng: 127 })],
		["경도가 -180보다 작으면", JSON.stringify({ name: "라면집", lat: 37, lng: -181 })],
		["좌표가 글자면", JSON.stringify({ name: "라면집", lat: "37", lng: "127" })],
	]) {
		test("restaurant " + what + " 식당 없이 시작한다", async () => {
			expect(await createdRestaurants(raw)).toEqual([null, null]);
		});
	}

	test("위도 90·경도 -180 처럼 범위 끝은 받는다", async () => {
		const [first] = await createdRestaurants(JSON.stringify({ name: "끝집", lat: 90, lng: -180 }));
		expect(first).toMatchObject({ name: "끝집", lat: 90, lng: -180 });
	});
});

describe("후보 넣기·빼기", () => {
	function add(name) {
		$("optionInput").value = name;
		$("addForm").requestSubmit();
	}

	test("적은 이름을 후보로 넣고 칸을 비운다", async () => {
		await start("");
		add("  라면 ");
		expect(chipNames()).toEqual(["라면"]);
		expect($("optionInput").value).toBe("");
		expect($("optionCount").textContent).toBe("1");
	});

	test("빈 칸이면 아무것도 하지 않는다", async () => {
		await start("?menus=라면");
		add("   ");
		expect(chipNames()).toEqual(["라면"]);
		expect($("createMessage").dataset.state).toBeUndefined();
	});

	test("이미 있는 후보는 넣지 않고 오류로 알린다", async () => {
		await start("?menus=라면");
		add("라면");
		expect(chipNames()).toEqual(["라면"]);
		expect($("createMessage").textContent).toBe("이미 있는 후보예요.");
		expect($("createMessage").dataset.state).toBe("error");
	});

	test("3개를 채우면 칸이 꺼지고, 그래도 보내면 3개까지라고 알린다", async () => {
		await start("?menus=라면,우동");
		add("김밥");
		expect($("optionInput").disabled).toBe(true);
		add("떡볶이");
		expect(chipNames()).toEqual(["라면", "우동", "김밥"]);
		expect($("createMessage").textContent).toBe("후보는 3개까지예요.");
	});

	test("오류 안내는 모일 곳이 정해진 뒤에도 남고, 후보가 모자라면 안내로 바뀐다", async () => {
		await start("?menus=라면,우동&place=시청역&lat=37.5&lng=127");
		add("라면");
		expect($("createMessage").textContent).toBe("이미 있는 후보예요.");
		// 다른 후보를 넣어도 오류 안내는 지우지 않아요.
		add("김밥");
		expect($("createMessage").textContent).toBe("이미 있는 후보예요.");
		$("optionChips").querySelectorAll(".vote-chip-remove")[0].click();
		$("optionChips").querySelectorAll(".vote-chip-remove")[0].click();
		expect($("createMessage").textContent).toBe("후보를 2개 이상 넣어 주세요.");
		expect($("createMessage").dataset.state).toBeUndefined();
	});

	test("× 로 그 후보와 붙은 식당을 함께 빼고 칸을 다시 켠다", async () => {
		const restaurant = JSON.stringify({ name: "라면집", lat: 37.56, lng: 126.97 });
		await start("?" + new URLSearchParams({ menus: "라면,우동,김밥", restaurant }));
		const remove = $("optionChips").querySelectorAll(".vote-chip-remove")[0];
		expect(remove.getAttribute("aria-label")).toBe("라면 빼기");
		remove.click();
		expect(chipNames()).toEqual(["우동", "김밥"]);
		expect($("optionChips").querySelector(".vote-candidate-restaurant")).toBeNull();
		expect($("optionInput").disabled).toBe(false);
	});

	test("'식당 떼기'를 누르면 그 후보의 식당만 지운다", async () => {
		const restaurant = JSON.stringify({ name: "라면집", lat: 37.56, lng: 126.97 });
		await start("?" + new URLSearchParams({ menus: "라면,우동", restaurant }));
		$("optionChips").querySelector(".text-button").click();
		expect($("optionChips").querySelector(".vote-candidate-restaurant")).toBeNull();
		expect(chipNames()).toEqual(["라면", "우동"]);
	});
});

describe("모일 곳 정하기", () => {
	test("위치 칸을 누르면 장소 찾기 창을 열고, 고른 곳을 모일 곳으로 둔다", async () => {
		useFakeKakao({ keywordSearch: () => [[kakaoPlace("시청역", { x: "126.977", y: "37.565" })], KakaoStatus.OK] });
		const calls = await start("?menus=라면,우동&place=시청", { rpc: { create_menu_poll: { data: [{ id: POLL_ID, host_token: "t" }], error: null }, menu_poll_state: { data: pollState(), error: null } } });
		$("pollPlace").click();
		await settle();
		expect($("placePicker").open).toBe(true);
		$("placePicker").querySelector(".place-picker-results button").click();
		await settle();
		expect($("pollPlace").value).toBe("시청역");
		expect($("createButton").disabled).toBe(false);
		$("createButton").click();
		await settle();
		expect(rpcCalls(calls, "create_menu_poll")[0].params).toMatchObject({ p_area_label: "시청역", p_area_lat: 37.565, p_area_lng: 126.977 });
	});

	test("장소 검색이 안 되는 채로 창을 닫으면 위치 칸에 직접 적게 바꾼다", async () => {
		useFakeKakao({ keywordSearch: () => [[], KakaoStatus.ERROR] });
		await start("?menus=라면,우동&place=시청");
		$("pollPlace").click();
		await settle();
		$("placePicker").querySelector(".place-picker-close").click();
		await settle();
		expect($("pollPlace").readOnly).toBe(false);
		expect(document.activeElement).toBe($("pollPlace"));
	});

	test("직접 적는 칸에서는 누르기로 창을 열지 않고, 적은 글자를 이름만 있는 모일 곳으로 둔다", async () => {
		await start("?menus=라면,우동");
		const input = $("pollPlace");
		input.readOnly = false;
		input.click();
		await settle();
		expect($("placePicker").open).toBe(false);
		input.value = "시청역";
		input.dispatchEvent(new Event("input"));
		expect($("createButton").disabled).toBe(false);
		input.value = "   ";
		input.dispatchEvent(new Event("input"));
		expect($("createButton").disabled).toBe(true);
		expect($("createMessage").textContent).toBe("모일 곳을 정해 주세요.");
	});

	test("현재 위치 단추는 좌표와 카카오 주소(60자까지)로 모일 곳을 정한다", async () => {
		setGlobal(window, "isSecureContext", true);
		setGlobal(navigator, "geolocation", { getCurrentPosition: (ok) => ok({ coords: { latitude: 37.4, longitude: 127.2 } }) });
		useFakeKakao({ coord2Address: () => [[{ road_address: { address_name: "서울 중구 세종대로 110" } }], KakaoStatus.OK] });
		const calls = await start("?menus=라면,우동", { rpc: { create_menu_poll: { data: [{ id: POLL_ID, host_token: "t" }], error: null }, menu_poll_state: { data: pollState(), error: null } } });
		$("pollCurrentButton").click();
		await settle();
		expect($("pollPlace").value).toBe("서울 중구 세종대로 110");
		expect($("pollCurrentButton").disabled).toBe(false);
		$("createButton").click();
		await settle();
		expect(rpcCalls(calls, "create_menu_poll")[0].params).toMatchObject({ p_area_label: "서울 중구 세종대로 110", p_area_lat: 37.4, p_area_lng: 127.2 });
	});

	test("주소를 못 찾으면 '현재 위치'로 둔다", async () => {
		setGlobal(window, "isSecureContext", true);
		setGlobal(navigator, "geolocation", { getCurrentPosition: (ok) => ok({ coords: { latitude: 37.4, longitude: 127.2 } }) });
		useFakeKakao({ coord2Address: () => [[], KakaoStatus.ZERO_RESULT] });
		await start("?menus=라면,우동");
		$("pollCurrentButton").click();
		await settle();
		expect($("pollPlace").value).toBe("현재 위치");
	});

	test("위치 권한이 없으면 그 안내를 오류로 보여 주고 단추를 다시 켠다", async () => {
		setGlobal(window, "isSecureContext", true);
		setGlobal(navigator, "geolocation", { getCurrentPosition: (_, fail) => fail({ code: 1 }) });
		await start("?menus=라면,우동");
		$("pollCurrentButton").click();
		await settle();
		expect($("createMessage").textContent).toStartWith("위치 권한이 꺼져 있어요.");
		expect($("createMessage").dataset.state).toBe("error");
		expect($("pollCurrentButton").disabled).toBe(false);
	});
});

describe("투표 만들기", () => {
	const ready = "?menus=라면,우동&place=시청역&lat=37.5&lng=127";

	test("후보·모일 곳·식당을 보내고, 방장 키를 저장한 뒤 주소를 ?id= 로 바꿔 투표를 연다", async () => {
		const calls = await start(ready, {
			rpc: {
				create_menu_poll: { data: [{ id: POLL_ID, host_token: "host-1" }], error: null },
				menu_poll_state: { data: pollState(), error: null },
			},
		});
		$("createButton").click();
		expect($("createButton").textContent).toBe("만드는 중…");
		expect($("createButton").disabled).toBe(true);
		await settle();
		expect(rpcCalls(calls, "create_menu_poll")[0].params).toEqual({
			p_options: ["라면", "우동"],
			p_area_label: "시청역",
			p_area_lat: 37.5,
			p_area_lng: 127,
			p_restaurants: [null, null],
		});
		expect(localStorage.getItem("omechu.pollHost." + POLL_ID)).toBe("host-1");
		expect(location.search).toBe("?id=" + POLL_ID);
		expect(location.pathname).toBe("/vote.html");
		expect(rpcCalls(calls, "menu_poll_state")[0].params).toMatchObject({ p_poll: POLL_ID, p_host_token: "host-1" });
		expect(visible("pollView")).toBe(true);
		expect(visible("createView")).toBe(false);
		expect($("createButton").textContent).toBe("투표 만들기");
	});

	test("DB 가 P0001 로 막으면 그 메시지를 그대로 보여 준다", async () => {
		await start(ready, { rpc: { create_menu_poll: { data: null, error: { code: "P0001", message: "후보 이름이 너무 길어요." } } } });
		$("createButton").click();
		await settle();
		expect($("createMessage").textContent).toBe("후보 이름이 너무 길어요.");
		expect($("createMessage").dataset.state).toBe("error");
		expect($("createButton").textContent).toBe("투표 만들기");
		expect($("createButton").disabled).toBe(false);
		expect(visible("createView")).toBe(true);
	});

	test("다른 코드의 오류는 일반 문구로 보여 준다", async () => {
		await start(ready, { rpc: { create_menu_poll: { data: null, error: { code: "42501", message: "permission denied" } } } });
		$("createButton").click();
		await settle();
		expect($("createMessage").textContent).toBe("투표를 만들지 못했어요. 잠시 후 다시 눌러 주세요.");
	});

	test("코드 없는 오류(좌표 찾기 실패)는 그 메시지를 보여 준다", async () => {
		fakeFetch(() => ({ ok: true, status: 200, json: async () => [] }));
		await start("?menus=라면,우동&place=없는동네", { rpc: {} });
		$("createButton").click();
		await settle();
		expect($("createMessage").textContent).toBe("'없는동네' 위치를 찾지 못했어요. 역 이름이나 동 이름으로 적어 주세요.");
	});

	test("Supabase 가 없으면 설정이 없다고 알린다", async () => {
		await start(ready);
		useNoSupabase();
		$("createButton").click();
		await settle();
		expect($("createMessage").textContent).toBe("Supabase 설정이 없어요.");
	});
});

describe("투표 열기", () => {
	test("id 가 UUID 모양이 아니면 RPC 없이 찾을 수 없다고 한다", async () => {
		const calls = await start("?id=abc");
		expect(visible("noticeView")).toBe(true);
		expect($("noticeText").textContent).toBe("투표를 찾을 수 없어요. 링크가 맞는지 확인해 주세요.");
		expect(calls).toEqual([]);
	});

	test("UUID 는 대문자여도 받는다", async () => {
		const calls = await start("?id=" + POLL_ID.toUpperCase(), { rpc: { menu_poll_state: { data: pollState(), error: null } } });
		expect(rpcCalls(calls, "menu_poll_state")[0].params.p_poll).toBe(POLL_ID.toUpperCase());
		expect(visible("pollView")).toBe(true);
	});

	test("데이터가 없으면 찾을 수 없다고 한다", async () => {
		await start("?id=" + POLL_ID, { rpc: { menu_poll_state: { data: null, error: null } } });
		expect($("noticeText").textContent).toBe("투표를 찾을 수 없어요. 링크가 맞는지 확인해 주세요.");
	});

	test("처음 읽기가 실패하면 새로고침하라고 안내한다", async () => {
		await start("?id=" + POLL_ID, { rpc: { menu_poll_state: { data: null, error: { message: "down" } } } });
		expect(visible("noticeView")).toBe(true);
		expect($("noticeText").textContent).toBe("투표를 불러오지 못했어요. 잠시 후 새로고침해 주세요.");
		expect($("refreshButton").disabled).toBe(false);
	});

	test("한 번 읽은 뒤 다시 읽기가 실패하면 화면은 두고 결과 칸에 알린다", async () => {
		let fail = false;
		await start("?id=" + POLL_ID, { rpc: { menu_poll_state: () => (fail ? { data: null, error: { message: "down" } } : { data: pollState(), error: null }) } });
		fail = true;
		$("refreshButton").click();
		await settle();
		expect(visible("pollView")).toBe(true);
		expect($("pollMessage").textContent).toBe("결과를 불러오지 못했어요. 잠시 후 다시 눌러 주세요.");
		expect($("pollMessage").dataset.state).toBe("error");
	});

	test("이 기기의 방장 키가 있으면 같이 보내고, 없으면 null 을 보낸다", async () => {
		localStorage.setItem("omechu.pollHost." + POLL_ID, "saved-token");
		let calls = await start("?id=" + POLL_ID, { rpc: { menu_poll_state: { data: pollState(), error: null } } });
		expect(rpcCalls(calls, "menu_poll_state")[0].params.p_host_token).toBe("saved-token");
		localStorage.clear();
		calls = await start("?id=" + POLL_ID, { rpc: { menu_poll_state: { data: pollState(), error: null } } });
		expect(rpcCalls(calls, "menu_poll_state")[0].params.p_host_token).toBeNull();
	});

	test("10초마다 다시 읽되, 화면이 숨었거나 확정됐으면 읽지 않는다", async () => {
		let state = pollState();
		const calls = await start("?id=" + POLL_ID, { rpc: { menu_poll_state: () => ({ data: state, error: null }) } });
		expect(intervals.map((interval) => interval.ms)).toEqual([10_000]);
		const tick = intervals[0].callback;
		tick();
		await settle();
		expect(rpcCalls(calls, "menu_poll_state")).toHaveLength(2);
		setGlobal(document, "hidden", true);
		tick();
		await settle();
		expect(rpcCalls(calls, "menu_poll_state")).toHaveLength(2);
		setGlobal(document, "hidden", false);
		state = pollState({ confirmed_index: 0 });
		tick();
		await settle();
		tick();
		await settle();
		expect(rpcCalls(calls, "menu_poll_state")).toHaveLength(3);
	});

	test("화면이 다시 보이면 결과를 다시 읽는다", async () => {
		let responders = 1;
		await start("?id=" + POLL_ID, { rpc: { menu_poll_state: () => ({ data: pollState({ mine: [0], counts: [responders, 0], responders }), error: null }) } });
		expect($("responders").textContent).toBe("응답 1명");
		responders = 3;
		document.dispatchEvent(new Event("visibilitychange"));
		await settle();
		expect($("responders").textContent).toBe("응답 3명");
	});
});

describe("투표 화면 그리기", () => {
	async function open(state) {
		return start("?id=" + POLL_ID, { rpc: { menu_poll_state: { data: state, error: null } } });
	}

	test("마감 시각이 지났고 확정 전이면 마감 안내를 보여 준다", async () => {
		await open(pollState({ expires_at: new Date(Date.now() - 1000).toISOString() }));
		expect(visible("noticeView")).toBe(true);
		expect($("noticeText").textContent).toBe("이 투표는 마감됐어요.");
	});

	describe("남은 시간", () => {
		const now = Date.UTC(2026, 10, 4, 3, 0, 0);
		let clock;
		beforeEach(() => {
			clock = spyOn(Date, "now").mockReturnValue(now);
		});
		afterEach(() => {
			clock.mockRestore();
		});

		for (const [left, text] of [
			[2 * HOUR + 59 * 60_000, "2시간 뒤 마감"],
			[HOUR, "1시간 뒤 마감"],
			[HOUR - 1, "59분 뒤 마감"],
			[60_000, "1분 뒤 마감"],
			[59_999, "곧 마감"],
			[1, "곧 마감"],
		]) {
			test(left + "ms 남으면 '" + text + "'", async () => {
				await open(pollState({ expires_at: new Date(now + left).toISOString() }));
				expect($("deadline").textContent).toBe(text);
			});
		}

		test("마감 시각과 같으면 마감으로 본다", async () => {
			await open(pollState({ expires_at: new Date(now).toISOString() }));
			expect($("noticeText").textContent).toBe("이 투표는 마감됐어요.");
		});
	});

	test("아직 답하지 않았으면 답 칸을 보여 주고, 고르면 단추 글자가 '보내기'가 된다", async () => {
		await open(pollState());
		expect($("pollArea").textContent).toBe("모일 곳 · 시청역");
		expect(visible("answerForm")).toBe(true);
		expect(visible("resultBox")).toBe(false);
		expect(visible("confirmedBox")).toBe(false);
		const boxes = [...$("answerOptions").querySelectorAll("input")];
		expect(boxes.map((box) => box.value)).toEqual(["0", "1"]);
		expect(boxes.map((box) => box.getAttribute("aria-labelledby"))).toEqual(["voteOption0", "voteOption1"]);
		expect($("answerButton").textContent).toBe("다 못 먹어요");
		boxes[1].checked = true;
		$("answerForm").dispatchEvent(new Event("change"));
		expect($("answerButton").textContent).toBe("보내기");
	});

	test("식당이 붙은 후보는 답 칸에 식당 이름·도보 시간·주소·지도 링크를 설명으로 붙인다", async () => {
		const restaurant = { key: "k", name: "목포생태찌개", address: "서울 중구 무교로", lat: AREA.lat + 500 / 111000, lng: AREA.lng };
		await open(pollState({ restaurants: [restaurant, { name: "", lat: 0, lng: 0 }] }));
		const labels = [...$("answerOptions").querySelectorAll("label")];
		expect(labels[0].classList.contains("has-restaurant")).toBe(true);
		const block = labels[0].querySelector(".vote-check-place");
		expect(block.id).toBe("voteOptionPlace0");
		expect(labels[0].querySelector("input").getAttribute("aria-describedby")).toBe("voteOptionPlace0");
		expect(block.querySelector(".place-name-link").textContent).toBe("목포생태찌개");
		expect(block.textContent).toContain("도보 약 10분 · 500m");
		expect(block.textContent).toContain("서울 중구 무교로");
		expect(block.querySelector(".vote-map-link").href).toStartWith("https://map.kakao.com/link/map/");
		// 모양이 어긋난 식당은 없는 것으로 봐요.
		expect(labels[1].classList.contains("has-restaurant")).toBe(false);
	});

	test("restaurants 가 배열이 아니면 식당 없이 그린다", async () => {
		await open(pollState({ restaurants: { 0: { name: "x", lat: 1, lng: 1 } } }));
		expect($("answerOptions").querySelector(".vote-check-place")).toBeNull();
	});

	test("답한 뒤에는 결과를 보여 주고 '답 고치기'로 내 답을 고른 채 답 칸을 다시 연다", async () => {
		await open(pollState({ mine: [1], counts: [1, 2], responders: 2, common: [] }));
		expect(visible("answerForm")).toBe(false);
		expect(visible("resultBox")).toBe(true);
		expect(visible("editButton")).toBe(true);
		$("editButton").click();
		expect(visible("answerForm")).toBe(true);
		expect(visible("resultBox")).toBe(false);
		expect([...$("answerOptions").querySelectorAll("input")].map((box) => box.checked)).toEqual([false, true]);
		expect($("answerButton").textContent).toBe("보내기");
		expect(document.activeElement).toBe($("answerOptions").querySelector("input"));
	});

	test("답했지만 결과(counts)가 아직 없으면 결과 칸을 숨긴다", async () => {
		await open(pollState({ mine: [0], counts: null }));
		expect(visible("answerForm")).toBe(false);
		expect(visible("resultBox")).toBe(false);
	});

	test("결과: 모두 가능한 후보는 표시하고, 나머지는 n/m명으로 적으며, 방장에게만 '이걸로 정하기'를 준다", async () => {
		await open(pollState({ mine: [0], counts: [3, 1], responders: 3, common: [0], is_host: true }));
		expect($("responders").textContent).toBe("응답 3명");
		const items = [...$("resultList").children];
		expect(items.map((item) => item.className)).toEqual(["vote-result is-common", "vote-result"]);
		expect(items.map((item) => item.querySelector(".vote-option-count").textContent)).toEqual(["모두 가능", "1/3명"]);
		expect(items[0].querySelector(".vote-confirm").textContent).toBe("이걸로 정하기");
		expect(items[1].querySelector(".vote-confirm")).toBeNull();
		expect($("resultNote").textContent).toBe("");
		expect(visible("restartLink")).toBe(false);
	});

	test("방장이 아니면 정하기 단추 대신 방장이 정한다고 알린다", async () => {
		await open(pollState({ mine: [0], counts: [2, 0], responders: 2, common: [0], is_host: false }));
		expect($("resultList").querySelector(".vote-confirm")).toBeNull();
		expect($("resultNote").textContent).toBe("만든 사람이 정하면 여기에 나와요.");
	});

	test("모두 가능한 후보가 없으면 알리고, 방장에게는 같은 모일 곳으로 다시 만드는 링크를 보여 준다", async () => {
		await open(pollState({ mine: [], counts: [1, 1], responders: 2, common: [], is_host: true }));
		expect($("resultNote").textContent).toBe("모두 먹을 수 있는 메뉴가 없어요.");
		expect(visible("restartLink")).toBe(true);
		expect(new URL($("restartLink").href).search).toBe("?" + new URLSearchParams({ place: "시청역" }));
	});

	test("방장이 아니면 공통 후보가 없어도 다시 만들기 링크를 숨긴다", async () => {
		await open(pollState({ mine: [], counts: [1, 1], responders: 2, common: [], is_host: false }));
		expect($("resultNote").textContent).toBe("모두 먹을 수 있는 메뉴가 없어요.");
		expect(visible("restartLink")).toBe(false);
	});

	test("아직 아무도 답하지 않았으면 안내 글이 없다", async () => {
		await open(pollState({ mine: [], counts: [0, 0], responders: 0, common: [], is_host: true }));
		expect($("resultNote").textContent).toBe("");
		expect(visible("restartLink")).toBe(false);
	});

	test("확정되면 정한 메뉴와 식당 상자를 보여 주고, 근처 식당 보기는 글자 단추로 내린다", async () => {
		const restaurant = { key: "k", name: "목포생태찌개", address: "서울 중구", lat: 37.567, lng: 126.979 };
		await open(pollState({ confirmed_index: 0, restaurants: [restaurant, null], expires_at: new Date(Date.now() - HOUR).toISOString() }));
		expect(visible("pollView")).toBe(true);
		expect(visible("confirmedBox")).toBe(true);
		expect(visible("answerForm")).toBe(false);
		expect(visible("resultBox")).toBe(false);
		expect(visible("refreshButton")).toBe(false);
		expect($("deadline").textContent).toBe("");
		expect($("confirmedName").textContent).toBe("김치찌개");
		const card = $("confirmedRestaurant").querySelector(".restaurant-card");
		expect(card.querySelector(".restaurant-label").textContent).toBe("추천 식당 · 김치찌개");
		// 확정 상자에서는 가게 문제 알리기 단추를 두지 않아요.
		expect(card.querySelector(".report-button")).toBeNull();
		expect($("restaurantLink").className).toBe("text-button vote-go-text");
		const link = new URL($("restaurantLink").href);
		expect(link.pathname).toBe("/index.html");
		expect(Object.fromEntries(link.searchParams)).toEqual({ menu: "김치찌개", place: "시청역", lat: "37.5665", lng: "126.978" });
	});

	test("확정된 후보에 식당이 없으면 식당 상자 없이 '근처 식당 보기'를 큰 단추로 둔다", async () => {
		await open(pollState({ confirmed_index: 1 }));
		expect($("confirmedName").textContent).toBe("돈가스");
		expect($("confirmedRestaurant").children).toHaveLength(0);
		expect($("restaurantLink").className).toBe("primary vote-create vote-go");
	});
});

describe("답 보내기·정하기", () => {
	test("고른 후보 번호를 보내고 결과를 다시 읽는다", async () => {
		let mine = null;
		const calls = await start("?id=" + POLL_ID, {
			rpc: {
				menu_poll_state: () => ({ data: pollState({ mine, counts: mine && [1, 0], responders: mine ? 1 : 0, common: mine ? [0] : [] }), error: null }),
				submit_menu_poll_response: (params) => {
					mine = params.p_accepted;
					return { data: null, error: null };
				},
			},
		});
		$("answerOptions").querySelector("input").checked = true;
		$("answerForm").requestSubmit();
		await settle();
		const [submitted] = rpcCalls(calls, "submit_menu_poll_response");
		expect(submitted.params).toMatchObject({ p_poll: POLL_ID, p_accepted: [0] });
		expect(submitted.params.p_voter).toMatch(/^[0-9a-f]{32}$/);
		expect(rpcCalls(calls, "menu_poll_state")).toHaveLength(2);
		expect(visible("resultBox")).toBe(true);
		expect($("answerButton").disabled).toBe(false);
	});

	test("아무것도 안 고르면 빈 목록을 보낸다", async () => {
		const calls = await start("?id=" + POLL_ID, { rpc: { menu_poll_state: { data: pollState(), error: null }, submit_menu_poll_response: { data: null, error: null } } });
		$("answerForm").requestSubmit();
		await settle();
		expect(rpcCalls(calls, "submit_menu_poll_response")[0].params.p_accepted).toEqual([]);
	});

	test("P0001 오류는 그 메시지를, 다른 오류는 저장하지 못했다고 알리고 결과를 다시 읽는다", async () => {
		let error = { code: "P0001", message: "마감된 투표예요." };
		const calls = await start("?id=" + POLL_ID, { rpc: { menu_poll_state: { data: pollState(), error: null }, submit_menu_poll_response: () => ({ data: null, error }) } });
		$("answerForm").requestSubmit();
		await settle();
		expect($("pollMessage").textContent).toBe("마감된 투표예요.");
		expect($("pollMessage").dataset.state).toBe("error");
		expect(rpcCalls(calls, "menu_poll_state")).toHaveLength(2);
		error = { code: "08006", message: "network" };
		$("answerForm").requestSubmit();
		await settle();
		expect($("pollMessage").textContent).toBe("답을 저장하지 못했어요. 잠시 후 다시 눌러 주세요.");
		expect($("answerButton").disabled).toBe(false);
	});

	test("방장이 '이걸로 정하기'를 누르면 방장 키와 번호를 보내고 확정 화면으로 바뀐다", async () => {
		localStorage.setItem("omechu.pollHost." + POLL_ID, "host-1");
		let confirmed = null;
		const calls = await start("?id=" + POLL_ID, {
			rpc: {
				menu_poll_state: () => ({ data: pollState({ mine: [1], counts: [1, 1], responders: 1, common: [1], is_host: true, confirmed_index: confirmed }), error: null }),
				confirm_menu_poll: (params) => {
					confirmed = params.p_index;
					return { data: null, error: null };
				},
			},
		});
		$("resultList").querySelector(".vote-confirm").click();
		await settle();
		expect(rpcCalls(calls, "confirm_menu_poll")[0].params).toEqual({ p_poll: POLL_ID, p_host_token: "host-1", p_index: 1 });
		expect(visible("confirmedBox")).toBe(true);
		expect($("confirmedName").textContent).toBe("돈가스");
	});

	test("정하기가 P0001 로 막히면 그 메시지를, 다른 오류는 일반 문구를 보여 주고 결과를 다시 읽는다", async () => {
		let error = { code: "P0001", message: "방장만 정할 수 있어요." };
		const calls = await start("?id=" + POLL_ID, {
			rpc: {
				menu_poll_state: { data: pollState({ mine: [0], counts: [1, 0], responders: 1, common: [0], is_host: true }), error: null },
				confirm_menu_poll: () => ({ data: null, error }),
			},
		});
		$("resultList").querySelector(".vote-confirm").click();
		await settle();
		expect($("pollMessage").textContent).toBe("방장만 정할 수 있어요.");
		expect(rpcCalls(calls, "menu_poll_state")).toHaveLength(2);
		error = { code: "500", message: "x" };
		$("resultList").querySelector(".vote-confirm").click();
		await settle();
		expect($("pollMessage").textContent).toBe("정하지 못했어요. 잠시 후 다시 눌러 주세요.");
		expect(visible("confirmedBox")).toBe(false);
	});

	test("새로고침 단추는 안내를 지우고 다시 읽는 동안 꺼진다", async () => {
		const calls = await start("?id=" + POLL_ID, { rpc: { menu_poll_state: { data: pollState(), error: null } } });
		$("pollMessage").textContent = "옛 안내";
		$("refreshButton").click();
		expect($("refreshButton").disabled).toBe(true);
		expect($("pollMessage").textContent).toBe("");
		await settle();
		expect($("refreshButton").disabled).toBe(false);
		expect(rpcCalls(calls, "menu_poll_state")).toHaveLength(2);
	});
});

describe("링크 공유", () => {
	const restaurant = { key: "k", name: "목포생태찌개", lat: 37.567, lng: 126.979 };
	const expectedText = "먹을 수 있는 메뉴를 골라 주세요. 후보: 김치찌개 · 목포생태찌개, 돈가스 (모일 곳: 시청역)";
	const expectedUrl = "https://app.test/vote.html?id=" + POLL_ID;

	async function open() {
		await start("?id=" + POLL_ID, { rpc: { menu_poll_state: { data: pollState({ restaurants: [restaurant, null] }), error: null } } });
	}

	function fakeClipboard(write) {
		const written = [];
		setGlobal(navigator, "clipboard", {
			writeText: async (text) => {
				written.push(text);
				return write?.(text);
			},
		});
		return written;
	}

	test("공유 창이 있으면 식당 이름을 붙인 후보와 투표 주소로 연다", async () => {
		const shared = [];
		setGlobal(navigator, "share", async (data) => {
			shared.push(data);
		});
		const written = fakeClipboard();
		await open();
		$("shareButton").click();
		await settle();
		expect(shared).toEqual([{ title: "오메추 같이 정하기", text: expectedText, url: expectedUrl }]);
		expect(written).toEqual([]);
	});

	test("공유 창을 사용자가 닫으면(AbortError) 복사하지 않는다", async () => {
		setGlobal(navigator, "share", async () => {
			throw Object.assign(new Error("abort"), { name: "AbortError" });
		});
		const written = fakeClipboard();
		await open();
		$("shareButton").click();
		await settle();
		expect(written).toEqual([]);
		expect($("shareButton").textContent).toBe("링크 공유하기");
	});

	test("공유 창이 다른 오류로 실패하면 글과 주소를 복사한다", async () => {
		setGlobal(navigator, "share", async () => {
			throw Object.assign(new Error("no"), { name: "NotAllowedError" });
		});
		const written = fakeClipboard();
		await open();
		$("shareButton").click();
		await settle();
		expect(written).toEqual([expectedText + "\n" + expectedUrl]);
		expect($("shareButton").textContent).toBe("복사했어요");
	});

	test("공유 창이 없으면 복사하고, 2초 뒤 글자를 되돌린다", async () => {
		setGlobal(navigator, "share", undefined);
		const written = fakeClipboard();
		await open();
		const realTimeout = globalThis.setTimeout;
		const timers = [];
		setGlobal(globalThis, "setTimeout", (callback, ms) => {
			if (ms === 2000) {
				timers.push(callback);
				return 1;
			}
			return realTimeout(callback, ms);
		});
		$("shareButton").click();
		await settle();
		expect(written).toHaveLength(1);
		expect($("shareButton").textContent).toBe("복사했어요");
		expect(timers).toHaveLength(1);
		timers[0]();
		expect($("shareButton").textContent).toBe("링크 공유하기");
	});

	test("복사도 실패하면 공유하지 못했다고 보여 준다", async () => {
		setGlobal(navigator, "share", undefined);
		fakeClipboard(() => {
			throw new Error("denied");
		});
		await open();
		$("shareButton").click();
		await settle();
		expect($("shareButton").textContent).toBe("공유하지 못했어요");
	});
});

describe("이 기기의 답하는 사람 글자열(voter)", () => {
	async function voterSent() {
		const calls = await start("?id=" + POLL_ID, { rpc: { menu_poll_state: { data: pollState(), error: null } } });
		return rpcCalls(calls, "menu_poll_state")[0].params.p_voter;
	}

	test("저장된 값이 8~64자면 그대로 쓴다", async () => {
		localStorage.setItem("omechu.voterId", "a".repeat(8));
		expect(await voterSent()).toBe("a".repeat(8));
		localStorage.setItem("omechu.voterId", "b".repeat(64));
		expect(await voterSent()).toBe("b".repeat(64));
	});

	test("없거나 8자보다 짧거나 64자보다 길면 새 32자 글자열을 만들어 저장한다", async () => {
		for (const saved of [null, "a".repeat(7), "a".repeat(65)]) {
			localStorage.clear();
			if (saved) {
				localStorage.setItem("omechu.voterId", saved);
			}
			const voter = await voterSent();
			expect(voter).toMatch(/^[0-9a-f]{32}$/);
			expect(localStorage.getItem("omechu.voterId")).toBe(voter);
		}
	});

	test("저장소가 막혀 있으면 새 글자열을 쓰고, 방장 키는 이 화면을 연 동안만 기억한다", async () => {
		const storage = Object.getPrototypeOf(localStorage);
		const getItem = spyOn(storage, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		const setItem = spyOn(storage, "setItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		try {
			const calls = await start("?menus=라면,우동&place=시청역&lat=37.5&lng=127", {
				rpc: {
					create_menu_poll: { data: [{ id: POLL_ID, host_token: "session-token" }], error: null },
					menu_poll_state: { data: pollState(), error: null },
				},
			});
			$("createButton").click();
			await settle();
			const [state] = rpcCalls(calls, "menu_poll_state");
			expect(state.params.p_voter).toMatch(/^[0-9a-f]{32}$/);
			expect(state.params.p_host_token).toBe("session-token");
		} finally {
			getItem.mockRestore();
			setItem.mockRestore();
		}
	});
});

describe("식당 붙이기 창", () => {
	const picker = () => $("restaurantPicker");
	const pickerMessage = () => picker().querySelector(".place-picker-message");
	const pickerItems = () => [...picker().querySelectorAll(".place-picker-results button")];

	function attachButton(index = 0) {
		return $("optionChips").querySelectorAll(".vote-candidate")[index].querySelector(".text-button");
	}

	test("모일 곳이 없으면 창을 열지 않고 먼저 정하라고 한다", async () => {
		await start("?menus=라면,우동");
		attachButton().click();
		await settle();
		expect(picker().open).toBe(false);
		expect($("createMessage").textContent).toBe("모일 곳을 먼저 정해 주세요.");
		expect($("createMessage").dataset.state).toBe("error");
	});

	test("메뉴 목록에 없는 이름이면 이름으로 가게를 찾고, 좌표가 없으면 먼저 찾아 모일 곳에 둔다", async () => {
		const urls = fakeFetch(() => geocodeAnswer("37.5665", "126.978"));
		const calls = await start("?menus=옛날국수,우동&place=시청역", {
			tables: { menus: { data: [kimchiStew], error: null } },
			rpc: {
				nearby_places: { data: [dbRow("옛날국수 본점", 300, { phone: "+82 2 111 2222" })], error: null },
				create_menu_poll: { data: [{ id: POLL_ID, host_token: "t" }], error: null },
				menu_poll_state: { data: pollState(), error: null },
			},
		});
		attachButton().click();
		expect(attachButton().disabled).toBe(true);
		expect(picker().open).toBe(true);
		expect(picker().querySelector(".restaurant-picker-title").textContent).toBe("옛날국수 · 시청역 근처");
		expect(pickerMessage().textContent).toBe("찾는 중…");
		await settle(10);
		expect(urls).toHaveLength(1);
		const [search] = rpcCalls(calls, "nearby_places");
		expect(search.params).toMatchObject({ p_lat: 37.5665, p_lng: 126.978, p_radius: 2000, p_terms: ["옛날국수"] });
		expect(pickerMessage().hidden).toBe(true);
		expect(pickerItems().map((item) => item.querySelector("strong").textContent)).toEqual(["옛날국수 본점"]);
		expect(pickerItems()[0].querySelector(".place-pick-walk").textContent).toBe("도보 약 6분 · 300m");
		expect(pickerItems()[0].querySelector(".place-pick-address").textContent).toBe("서울 중구");
		pickerItems()[0].click();
		await settle();
		expect(picker().open).toBe(false);
		expect(attachButton().textContent).toBe("식당 떼기");
		expect($("optionChips").querySelector(".vote-candidate-restaurant").textContent).toBe("옛날국수 본점");
		$("createButton").click();
		await settle();
		// 좌표는 붙이기 때 찾아 두어 다시 찾지 않아요.
		expect(urls).toHaveLength(1);
		const [created] = rpcCalls(calls, "create_menu_poll");
		const row = dbRow("옛날국수 본점", 300);
		expect(created.params.p_area_lat).toBe(37.5665);
		expect(created.params.p_restaurants).toEqual([
			{ key: placeKey(row), name: "옛날국수 본점", address: "서울 중구", phone: "02-111-2222", lat: row.lat, lng: row.lng },
			null,
		]);
	});

	test("후보 이름이 메뉴 이름과 같으면(띄어쓰기·대소문자 무시) 메뉴 추천과 같은 방식으로 찾는다", async () => {
		const calls = await start("?menus=김치 찌개,우동&place=시청역&lat=37.5665&lng=126.978", {
			tables: { menus: { data: [kimchiStew], error: null } },
			rpc: { nearby_places: (params) => ({ data: params.p_terms.includes("김치찌개") ? [dbRow("종로 김치찌개", 200), dbRow("명동 김치찌개", 400)] : [], error: null }) },
		});
		attachButton().click();
		await settle(20);
		const searches = rpcCalls(calls, "nearby_places");
		expect(searches.length).toBeGreaterThan(0);
		expect(searches[0].params.p_terms).toContain("김치찌개");
		expect(pickerItems().map((item) => item.querySelector("strong").textContent)).toEqual(["종로 김치찌개", "명동 김치찌개"]);
	});

	test("찾은 가게가 없으면 못 찾았다고 한다", async () => {
		fakeFetchWithMenus(() => geocodeAnswer());
		await start("?menus=옛날국수,우동&place=시청역&lat=37.5665&lng=126.978", {
			tables: { menus: { data: [], error: null } },
			rpc: { nearby_places: { data: [], error: null } },
		});
		attachButton().click();
		await settle(10);
		expect(pickerMessage().textContent).toBe("근처에서 식당을 찾지 못했어요.");
		expect(pickerItems()).toEqual([]);
	});

	test("메뉴 목록을 DB 와 기본 파일 모두에서 못 읽으면 이름으로 찾는다", async () => {
		fakeFetch(() => ({ ok: false, status: 500, json: async () => [] }));
		const calls = await start("?menus=김치찌개,우동&place=시청역&lat=37.5665&lng=126.978", {
			tables: { menus: { data: null, error: { message: "down" } } },
			rpc: { nearby_places: { data: [dbRow("김치찌개 하우스", 100)], error: null } },
		});
		attachButton().click();
		await settle(10);
		expect(rpcCalls(calls, "nearby_places")[0].params.p_terms).toEqual(["김치찌개"]);
		expect(pickerItems().map((item) => item.querySelector("strong").textContent)).toEqual(["김치찌개 하우스"]);
	});

	test("찾다가 오류가 나면 그 메시지를 창에 보여 주고 단추를 다시 켠다", async () => {
		fakeFetch(() => ({ ok: false, status: 503, json: async () => [] }));
		await start("?menus=옛날국수,우동&place=시청역");
		attachButton().click();
		await settle(10);
		expect(pickerMessage().textContent).toBe("동네 위치를 찾지 못했어요. 잠시 후 다시 눌러 주세요.");
		expect(picker().open).toBe(true);
		picker().querySelector(".place-picker-close").click();
		await settle();
		expect(attachButton().disabled).toBe(false);
		expect(attachButton().textContent).toBe("식당 붙이기");
	});

	test("찾는 사이 창을 닫으면 늦게 온 결과는 그리지 않고 식당도 붙이지 않는다", async () => {
		let reply;
		fakeFetchWithMenus(() => new Promise((resolve) => {
			reply = resolve;
		}));
		await start("?menus=옛날국수,우동&place=시청역", {
			tables: { menus: { data: [], error: null } },
			rpc: { nearby_places: { data: [dbRow("옛날국수 본점", 300)], error: null } },
		});
		attachButton().click();
		await settle();
		picker().querySelector(".place-picker-close").click();
		await settle();
		reply(geocodeAnswer());
		await settle(10);
		expect(attachButton().disabled).toBe(false);
		expect(pickerItems()).toEqual([]);
		expect(pickerMessage().textContent).toBe("찾는 중…");
		expect($("optionChips").querySelector(".vote-candidate-restaurant")).toBeNull();
	});

	test("앞 후보의 결과가 늦게 오면 버리고, 다시 연 후보의 결과만 그린다", async () => {
		const replies = [];
		fakeFetchWithMenus(() => new Promise((resolve) => {
			replies.push(resolve);
		}));
		await start("?menus=옛날국수,우동&place=시청역", {
			tables: { menus: { data: [], error: null } },
			rpc: { nearby_places: (params) => ({ data: [dbRow(params.p_terms[0] + " 가게", 100)], error: null }) },
		});
		attachButton(0).click();
		await settle();
		picker().close();
		await settle();
		attachButton(1).click();
		await settle();
		expect(picker().querySelector(".restaurant-picker-title").textContent).toBe("우동 · 시청역 근처");
		replies[1](geocodeAnswer());
		await settle(10);
		replies[0](geocodeAnswer());
		await settle(10);
		expect(pickerItems().map((item) => item.querySelector("strong").textContent)).toEqual(["우동 가게"]);
	});
});
