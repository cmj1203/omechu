import { afterEach, beforeEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { freshImport, loadPage, settle } from "./helpers/dom.js";
import { KakaoStatus, kakaoPlace, useFakeKakao } from "./helpers/fake-kakao.js";
import { failSupabase, useFakeSupabase, useNoSupabase } from "./helpers/fake-supabase.js";

// js/official.js 는 불러올 때 바로 official.html 의 TOP 30 을 불러오는 진입 모듈이에요. 시험마다 화면을 넣고 모듈을 새로 불러와요.
// 맛집 기록은 가짜 Supabase(official_picks 표, official_picks_near RPC)로, 동네 좌표는 가짜 fetch(nominatim)로 줘요.
const pick = (name, extra = {}) => ({
	name,
	address: "서울 중구 세종대로 110",
	category: "한식",
	lat: 37.5665,
	lng: 126.978,
	visits: 1234,
	departments: 5,
	avg_per_person: 14600,
	lunch_visits: 10,
	dinner_visits: 3,
	last_visit: "2026-10-01",
	agencies: "서울시 본청, 중구",
	...extra,
});

let restores = [];
let top;
let near;
let calls;
let fetch;

function override(target, key, value) {
	const own = Object.getOwnPropertyDescriptor(target, key);
	Object.defineProperty(target, key, { value, configurable: true, writable: true });
	restores.push(() => {
		if (own) {
			Object.defineProperty(target, key, own);
		} else {
			delete target[key];
		}
	});
}

function fakeDatabase() {
	calls = useFakeSupabase({
		tables: { official_picks: (query) => top(query) },
		rpc: { official_picks_near: (params) => near(params) },
	});
}

async function openOfficial({ hour = 9 } = {}) {
	override(window, "isSecureContext", true);
	setSystemTime(new Date(2026, 10, 4, hour, 0));
	await loadPage("official.html");
	await freshImport("js/official.js");
	await settle();
}

const $ = (id) => document.getElementById(id);
const status = () => $("officialStatus");
const items = () => [...$("officialList").querySelectorAll(".official-pick")];
const names = () => items().map((item) => item.querySelector("h3").textContent);
const chips = (item) => [...item.querySelectorAll(".official-facts .official-chip")].map((chip) => chip.textContent);
const topQueries = () => calls.filter((call) => call.table === "official_picks");
const nearCalls = () => calls.filter((call) => call.rpc === "official_picks_near").map((call) => call.params);

function choosePrice(value) {
	const input = $("officialSearch").querySelector("input[name=price][value='" + value + "']");
	input.checked = true;
	input.dispatchEvent(new Event("change", { bubbles: true }));
}

// 순서 칸은 폼 밖이라 happy-dom 이 같은 이름의 다른 칸을 끄지 않아서, 다른 칸은 직접 꺼요.
function chooseOrder(value) {
	for (const other of $("officialOrder").querySelectorAll("input")) {
		other.checked = false;
	}
	const input = $("officialOrder").querySelector("input[value='" + value + "']");
	input.checked = true;
	input.dispatchEvent(new Event("change", { bubbles: true }));
}

// 위치 칸에 직접 적는 방식(카카오를 못 불러온 때)으로 바꿔 적고 Enter 를 친 것과 같아요.
function typePlace(text) {
	$("officialPlace").readOnly = false;
	$("officialPlace").value = text;
	$("officialSearch").requestSubmit();
}

function geocodeAnswer(found = [{ lat: "37.5665", lon: "126.978" }], ok = true) {
	fetch.mockImplementation(async () => new Response(JSON.stringify(found), { status: ok ? 200 : 503 }));
}

beforeEach(() => {
	restores = [];
	top = () => ({ data: [pick("잼배옥")], error: null });
	near = () => ({ data: [], error: null });
	fakeDatabase();
	useFakeKakao();
	fetch = spyOn(globalThis, "fetch");
	geocodeAnswer();
	spyOn(console, "error").mockImplementation(() => {});
	spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	for (const restore of restores.reverse()) {
		restore();
	}
	setSystemTime();
	fetch.mockRestore();
	console.error.mockRestore();
	console.warn.mockRestore();
});

describe("TOP 30", () => {
	test("처음 열면 많이 간 순으로 30곳을 불러와 순위·이름·업종·주소·방문 정보를 보여 준다", async () => {
		await openOfficial();
		expect(topQueries()[0].ops.map(([name]) => name)).toEqual(["select", "order", "order", "limit", "abortSignal"]);
		expect(topQueries()[0].ops[0][1]).toBe("name,address,category,lat,lng,visits,departments,avg_per_person,lunch_visits,dinner_visits,last_visit,agencies");
		expect(topQueries()[0].ops.slice(1, 4)).toEqual([["order", "visits", { ascending: false }], ["order", "visits", { ascending: false }], ["limit", 30]]);
		expect($("officialListTitle").textContent).toBe("많이 간 곳 TOP 30");
		const [item] = items();
		expect(item.querySelector(".official-rank").textContent).toBe("1");
		expect(item.querySelector("h3 .place-name-link").textContent).toBe("잼배옥");
		expect(item.querySelector(".official-category").textContent).toBe("한식");
		expect(item.querySelector(".official-address").textContent).toBe("서울 중구 세종대로 110");
		expect(chips(item)).toEqual(["방문 1,234번 · 5개 부서", "1인 약 15,000원", "주로 점심", "최근 2026-10-01", "서울시 본청, 중구"]);
		expect(status().hidden).toBe(true);
		expect(status().dataset.state).toBe("ready");
		expect($("officialOrder").hidden).toBe(false);
		expect($("officialReset").hidden).toBe(true);
	});

	test("위치 없이 보는 TOP 목록의 길찾기는 도착지만 넣고, 이름의 쉼표는 공백으로 바꾼다", async () => {
		top = () => ({ data: [pick("밥,술", { lat: 37.1, lng: 127.2 })], error: null });
		await openOfficial();
		const [route, map] = items()[0].querySelectorAll(".official-map-link");
		expect(route.href).toBe("https://map.kakao.com/link/to/" + encodeURIComponent("밥 술") + ",37.1,127.2");
		expect(map.href).toBe("https://map.kakao.com/link/map/" + encodeURIComponent("밥 술") + ",37.1,127.2");
	});

	test("빈 값은 칩을 빼고, 주소가 없으면 없다고 적는다", async () => {
		top = () => ({
			data: [pick("빈 가게", { address: null, category: null, avg_per_person: null, lunch_visits: 2, dinner_visits: 2, last_visit: null, agencies: null, visits: null, departments: undefined })],
			error: null,
		});
		await openOfficial();
		const [item] = items();
		expect(item.querySelector(".official-category")).toBeNull();
		expect(item.querySelector(".official-address").textContent).toBe("주소 정보가 없어요.");
		expect(chips(item)).toEqual(["방문 0번 · 0개 부서"]);
	});

	test("저녁이 더 많으면 '주로 저녁', 글자 숫자도 숫자로 비교하고 1인 금액은 천 원 단위로 반올림한다", async () => {
		top = () => ({ data: [pick("저녁집", { lunch_visits: "2", dinner_visits: "10", avg_per_person: "25499" })], error: null });
		await openOfficial();
		expect(chips(items()[0])).toContain("주로 저녁");
		expect(chips(items()[0])).toContain("1인 약 25,000원");
	});

	test("기록이 없으면 준비 중이라고 알린다", async () => {
		top = () => ({ data: [], error: null });
		await openOfficial();
		expect(status().textContent).toBe("데이터를 준비하고 있어요.");
		expect(status().dataset.state).toBe("empty");
		expect(status().hidden).toBe(false);
	});

	test("data 가 null 이어도 빈 목록으로 본다", async () => {
		top = () => ({ data: null, error: null });
		await openOfficial();
		expect(status().textContent).toBe("데이터를 준비하고 있어요.");
	});

	test("DB 오류면 다시 열라고 알린다", async () => {
		top = () => ({ data: null, error: new Error("timeout") });
		await openOfficial();
		expect(status().textContent).toBe("맛집 기록을 불러오지 못했어요. 잠시 후 새로고침해 주세요.");
		expect(status().dataset.state).toBe("error");
	});

	test("Supabase 가 없거나 라이브러리를 못 받아도 같은 안내를 보여 준다", async () => {
		useNoSupabase();
		await openOfficial();
		expect(status().dataset.state).toBe("error");
		failSupabase(new Error("cdn"));
		await openOfficial();
		expect(status().textContent).toBe("맛집 기록을 불러오지 못했어요. 잠시 후 새로고침해 주세요.");
	});

	test("가격을 고르면 1인 평균이 그 값 이하인 곳만 다시 불러오고, 없으면 가격을 넓히라고 한다", async () => {
		await openOfficial();
		top = () => ({ data: [], error: null });
		choosePrice("15000");
		await settle();
		const query = topQueries().at(-1);
		expect(query.ops[1]).toEqual(["lte", "avg_per_person", 15000]);
		expect(status().textContent).toBe("이 가격 안에서 기록된 곳이 없어요. 가격 조건을 넓혀 보세요.");
	});

	test("순서를 바꾸면 그 순서로 다시 불러오고 제목도 바꾼다", async () => {
		await openOfficial();
		chooseOrder("dinner_visits");
		await settle();
		expect(topQueries().at(-1).ops[1]).toEqual(["order", "dinner_visits", { ascending: false }]);
		expect($("officialListTitle").textContent).toBe("저녁에 많이 간 곳 TOP 30");
	});

	test("늦게 온 앞 요청의 결과는 버린다", async () => {
		let releaseFirst;
		top = () => new Promise((resolve) => {
			releaseFirst = () => resolve({ data: [pick("늦은 결과")], error: null });
		});
		setSystemTime(new Date(2026, 10, 4, 9, 0));
		await loadPage("official.html");
		const loading = freshImport("js/official.js");
		await settle();
		top = () => ({ data: [pick("새 결과")], error: null });
		chooseOrder("lunch_visits");
		await settle();
		releaseFirst();
		await loading;
		await settle();
		expect(names()).toEqual(["새 결과"]);
	});
});

describe("처음 순서는 지금 시각에 맞춘다", () => {
	const cases = [
		[9, "visits", "많이 간 곳 TOP 30"],
		[10, "lunch_visits", "점심에 많이 간 곳 TOP 30"],
		[14, "lunch_visits", "점심에 많이 간 곳 TOP 30"],
		[15, "visits", "많이 간 곳 TOP 30"],
		[16, "dinner_visits", "저녁에 많이 간 곳 TOP 30"],
		[22, "dinner_visits", "저녁에 많이 간 곳 TOP 30"],
		[23, "visits", "많이 간 곳 TOP 30"],
		[0, "visits", "많이 간 곳 TOP 30"],
	];
	for (const [hour, order, title] of cases) {
		test(hour + "시 → " + order, async () => {
			await openOfficial({ hour });
			expect($("officialOrder").querySelector("input:checked").value).toBe(order);
			expect(topQueries()[0].ops[1]).toEqual(["order", order, { ascending: false }]);
			expect($("officialListTitle").textContent).toBe(title);
		});
	}

	test("경계 바로 앞(9:59, 14:59, 15:59, 22:59)은 앞 구간이다", async () => {
		for (const [hour, order] of [[9, "visits"], [14, "lunch_visits"], [15, "visits"], [22, "dinner_visits"]]) {
			setSystemTime(new Date(2026, 10, 4, hour, 59));
			await loadPage("official.html");
			await freshImport("js/official.js");
			await settle();
			expect($("officialOrder").querySelector("input:checked").value).toBe(order);
		}
	});
});

describe("근처 찾기", () => {
	test("적은 동네의 좌표를 찾아 1.5km 안 맛집을 거리·도보 시간과 함께 보여 준다", async () => {
		near = () => ({ data: [pick("가까운 집", { distance: 499.6 }), pick("먼 집", { distance: 1234 })], error: null });
		await openOfficial();
		typePlace(" 시청역 ");
		await settle();
		expect(new URL(fetch.mock.calls[0][0]).searchParams.get("q")).toBe("시청역");
		expect(nearCalls()).toEqual([{ p_lat: 37.5665, p_lng: 126.978, p_radius: 1500, p_max_price: null }]);
		expect(calls.find((call) => call.rpc).ops.map(([name]) => name)).toEqual(["abortSignal"]);
		expect($("officialListTitle").textContent).toBe("시청역 근처");
		expect($("officialOrder").hidden).toBe(true);
		expect($("officialReset").hidden).toBe(false);
		expect(chips(items()[0])[0]).toBe("500m · 도보 약 10분");
		expect(chips(items()[1])[0]).toBe("1.2km · 도보 약 24분");
		expect(items()[0].querySelector(".official-distance")).not.toBeNull();
		const route = items()[0].querySelector(".official-map-link");
		expect(route.href).toBe("https://map.kakao.com/link/from/" + encodeURIComponent("시청역") + ",37.5665,126.978/to/" + encodeURIComponent("가까운 집") + ",37.5665,126.978");
		expect($("officialCurrentButton").disabled).toBe(false);
	});

	test("거리가 숫자가 아니면 거리 칩을 빼고, 30곳까지만 보여 준다", async () => {
		near = () => ({ data: Array.from({ length: 35 }, (_, index) => pick("집" + index, { distance: "abc" })), error: null });
		await openOfficial();
		typePlace("시청역");
		await settle();
		expect(items()).toHaveLength(30);
		expect(items()[0].querySelector(".official-distance")).toBeNull();
	});

	test("1.5km 안에 없으면 3km까지 넓혀 찾고 그렇다고 알린다", async () => {
		near = (params) => ({ data: params.p_radius === 3000 ? [pick("넓혀 찾은 집", { distance: 2500 })] : [], error: null });
		await openOfficial();
		typePlace("시청역");
		await settle();
		expect(nearCalls().map((params) => params.p_radius)).toEqual([1500, 3000]);
		expect(names()).toEqual(["넓혀 찾은 집"]);
		expect(status().textContent).toBe("1.5km 안에는 없어서 3km까지 넓혀 찾았어요. 가까운 순으로 1곳을 보여 드려요.");
		expect(status().dataset.state).toBe("note");
	});

	test("3km 안에도 없으면 기록이 많은 곳을 알려 준다", async () => {
		await openOfficial();
		typePlace("시청역");
		await settle();
		expect(status().textContent).toBe("이 근처에는 기록된 곳이 없어요. 서울시청·은평구·서대문구·세종청사 근처에 많아요.");
		expect(status().dataset.state).toBe("empty");
	});

	test("빈 칸이면 동네를 적으라고 하고 찾지 않는다", async () => {
		await openOfficial();
		typePlace("  ");
		await settle();
		expect(status().textContent).toBe("동네나 역 이름을 입력해 주세요.");
		expect(status().dataset.state).toBe("error");
		expect(document.activeElement).toBe($("officialPlace"));
		expect(fetch).not.toHaveBeenCalled();
	});

	test("동네 좌표를 못 찾으면 안내하고, 그 뒤 가격을 바꾸면 TOP 목록으로 돌아간다", async () => {
		await openOfficial();
		geocodeAnswer([]);
		typePlace("없는동네");
		await settle();
		expect(status().textContent).toBe("'없는동네' 위치를 찾지 못했어요. 역 이름이나 동 이름으로 적어 주세요.");
		expect(items()).toEqual([]);
		expect($("officialReset").hidden).toBe(false);
		const before = topQueries().length;
		choosePrice("20000");
		await settle();
		expect(topQueries()).toHaveLength(before + 1);
		expect(nearCalls()).toEqual([]);
	});

	test("좌표 서버가 오류를 돌려줘도 안내한다", async () => {
		await openOfficial();
		geocodeAnswer([], false);
		typePlace("시청역");
		await settle();
		expect(status().textContent).toBe("동네 위치를 찾지 못했어요. 잠시 후 다시 눌러 주세요.");
	});

	test("근처 RPC 오류면 오류 글을 보여 준다", async () => {
		near = () => ({ data: null, error: { message: "" } });
		await openOfficial();
		typePlace("시청역");
		await settle();
		expect(status().textContent).toBe("근처 맛집을 찾지 못했어요. 잠시 후 다시 눌러 주세요.");
	});

	test("근처를 본 뒤 가격을 바꾸면 같은 곳 근처를 그 가격으로 다시 찾는다", async () => {
		near = () => ({ data: [pick("집", { distance: 100 })], error: null });
		await openOfficial();
		typePlace("시청역");
		await settle();
		choosePrice("30000");
		await settle();
		expect(nearCalls().at(-1)).toMatchObject({ p_radius: 1500, p_max_price: 30000 });
		expect(fetch).toHaveBeenCalledTimes(1);
		expect($("officialListTitle").textContent).toBe("시청역 근처");
	});

	test("'TOP 30 보기'를 누르면 위치를 잊고 TOP 목록으로 돌아간다", async () => {
		near = () => ({ data: [pick("집", { distance: 100 })], error: null });
		await openOfficial();
		typePlace("시청역");
		await settle();
		$("officialReset").click();
		await settle();
		expect($("officialListTitle").textContent).toBe("많이 간 곳 TOP 30");
		const before = nearCalls().length;
		choosePrice("15000");
		await settle();
		expect(nearCalls()).toHaveLength(before);
	});

	test("찾는 동안에는 다시 Enter 를 쳐도 한 번만 찾는다", async () => {
		let release;
		fetch.mockImplementation(() => new Promise((resolve) => {
			release = () => resolve(new Response(JSON.stringify([{ lat: "37.5", lon: "127" }])));
		}));
		await openOfficial();
		typePlace("시청역");
		expect($("officialCurrentButton").disabled).toBe(true);
		expect(status().textContent).toBe("시청역 근처를 찾고 있어요.");
		typePlace("강남역");
		release();
		await settle();
		expect(fetch).toHaveBeenCalledTimes(1);
		expect($("officialCurrentButton").disabled).toBe(false);
	});

	test("현재 위치로 찾으면 그 좌표 근처를 찾고 주소를 위치 칸에 넣는다", async () => {
		override(navigator, "geolocation", {
			getCurrentPosition: (ok) => ok({ coords: { latitude: 37.55, longitude: 126.97 } }),
		});
		useFakeKakao({ coord2Address: () => [[{ road_address: { address_name: "서울 중구 세종대로 110" } }], KakaoStatus.OK] });
		await openOfficial();
		$("officialCurrentButton").click();
		await settle();
		expect(nearCalls()[0]).toMatchObject({ p_lat: 37.55, p_lng: 126.97 });
		expect($("officialListTitle").textContent).toBe("현재 위치 근처");
		expect($("officialPlace").value).toBe("서울 중구 세종대로 110");
	});

	test("현재 위치 권한이 없으면 그 안내를 보여 준다", async () => {
		override(navigator, "geolocation", {
			getCurrentPosition: (ok, fail) => fail({ code: 1 }),
		});
		await openOfficial();
		$("officialCurrentButton").click();
		await settle();
		expect(status().textContent).toStartWith("위치 권한이 꺼져 있어요.");
		expect(status().dataset.state).toBe("error");
		expect(nearCalls()).toEqual([]);
	});

	test("위치 칸을 누르면 장소 찾기 창을 열고, 고른 곳 근처를 찾는다", async () => {
		useFakeKakao({ keywordSearch: () => [[kakaoPlace("서대문구청", { x: "126.9368", y: "37.5791" })], KakaoStatus.OK] });
		near = () => ({ data: [pick("집", { distance: 100 })], error: null });
		await openOfficial();
		$("officialPlace").value = "서대문구청";
		$("officialPlace").click();
		await settle();
		document.querySelector("#placePicker .place-picker-results button").click();
		await settle();
		expect($("officialPlace").value).toBe("서대문구청");
		expect(nearCalls()[0]).toMatchObject({ p_lat: 37.5791, p_lng: 126.9368 });
		expect($("officialListTitle").textContent).toBe("서대문구청 근처");
	});

	test("장소 찾기가 안 돼 창을 닫으면 위치 칸에 직접 적게 바꾼다", async () => {
		useFakeKakao({ keywordSearch: () => [[], KakaoStatus.ERROR] });
		await openOfficial();
		$("officialPlace").value = "시청역";
		$("officialPlace").click();
		await settle();
		document.querySelector("#placePicker .place-picker-close").click();
		await settle();
		expect($("officialPlace").readOnly).toBe(false);
		expect(document.activeElement).toBe($("officialPlace"));
		expect(nearCalls()).toEqual([]);
	});

	test("장소를 고르지 않고 닫으면 아무것도 찾지 않는다", async () => {
		useFakeKakao({ keywordSearch: () => [[kakaoPlace("A")], KakaoStatus.OK] });
		await openOfficial();
		$("officialPlace").click();
		await settle();
		document.querySelector("#placePicker .place-picker-close").click();
		await settle();
		expect($("officialPlace").readOnly).toBe(true);
		expect(nearCalls()).toEqual([]);
	});
});
