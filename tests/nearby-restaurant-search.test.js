import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { useFakeRpc, useNoSupabase } from "./helpers/fake-supabase.js";
import { listRestaurants, searchRestaurants } from "../js/nearby-restaurant-search.js";

const origin = { label: "시청역", lat: 37.5, lng: 127 };
const kimchiStew = {
	name: "김치찌개",
	kinds: ["식사"],
	cuisine: "한식",
	search_terms: ["김치찌개", "찌개"],
	exclude_terms: ["부대찌개"],
	broad_terms: ["찌개"],
	broad_categories: ["한식/국/탕/찌개류"],
};
const chicken = { name: "치킨", kinds: ["식사", "술"], cuisine: "한식", search_terms: ["치킨"], categories: ["기타 간이/치킨"] };
const tonkatsu = { name: "돈가스", kinds: ["식사"], cuisine: "일식", search_terms: ["돈가스", "돈까스"] };

// 가게는 출발지에서 북쪽으로 distance 미터에 둬요. 이름이 다르면 서로 다른 가게로 봐요.
function row(name, distance, extra = {}) {
	return { name, amenity: "restaurant", shop: null, lat: 37.5 + distance / 111000, lng: 127, distance, walkMinutes: 1, phone: "", address: "", matched: true, officialVisits: 0, category: null, ...extra };
}

// nearby_places 결과를 반경·부름 순서로 돌려줘요. 같은 반경에서 첫 부름은 추천 메뉴, 둘째 부름은 조건 메뉴예요.
function answer(byRadius) {
	return useFakeRpc((params, call) => {
		const found = byRadius[params.p_radius]?.[call === 0 ? "menu" : "filters"];
		if (found instanceof Error) {
			return { data: null, error: found };
		}
		return { data: (found ?? []).map((place) => toRow(place)), error: null };
	});
}

// row() 로 만든 가게를 DB 결과 줄 모양으로 되돌려요.
function toRow({ officialVisits, walkMinutes, ...place }) {
	return { ...place, official_visits: officialVisits };
}

const names = (places) => places.map((place) => place.name);

let random;
let warn;

beforeEach(() => {
	useNoSupabase();
	random = spyOn(Math, "random").mockReturnValue(0);
	warn = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	random.mockRestore();
	warn.mockRestore();
});

describe("searchRestaurants: 2km 안에서 고르기", () => {
	test("메뉴 이름 가게가 여럿이면 가까운 곳을 고르고 나머지는 같은 메뉴 가게로 보여 준다", async () => {
		const calls = answer({ 2000: { menu: [row("김치찌개 A", 300), row("김치찌개 B", 100), row("동네 찌개집", 50)] } });
		const found = await searchRestaurants(kimchiStew, [kimchiStew], origin);
		expect(found.mode).toBe("menu");
		expect(found.pick).toMatchObject({ name: "김치찌개 B", menuName: "김치찌개" });
		expect(found.others).toEqual([expect.not.objectContaining({ menuName: expect.anything() })]);
		expect(names(found.others)).toEqual(["김치찌개 A"]);
		expect(found.othersSameMenu).toBe(true);
		expect(found.searchedKm).toBe(2);
		expect(calls).toHaveLength(2);
	});

	test("추천 메뉴 검색은 비슷한 가게까지, 조건 검색은 주력 검색어·주력 업종으로 부른다", async () => {
		const calls = answer({});
		await searchRestaurants(kimchiStew, [kimchiStew, chicken], origin);
		expect(calls[0].params).toMatchObject({ p_terms: ["김치찌개", "찌개"], p_similar_amenities: ["restaurant", "fast_food"], p_similar_cuisine: "korean", p_categories: ["한식/국/탕/찌개류"] });
		expect(calls[1].params).toMatchObject({ p_terms: ["김치찌개", "치킨"], p_similar_amenities: [], p_categories: ["기타 간이/치킨"] });
	});

	test("가장 가까운 3곳 중에서 무작위로 고른다", async () => {
		random.mockReturnValue(0.99);
		answer({ 2000: { menu: [row("김치찌개 1", 100), row("김치찌개 2", 200), row("김치찌개 3", 300), row("김치찌개 4", 400)] } });
		const found = await searchRestaurants(kimchiStew, [kimchiStew], origin);
		expect(found.pick.name).toBe("김치찌개 3");
		expect(names(found.others)).toEqual(["김치찌개 1", "김치찌개 2", "김치찌개 4"]);
	});

	test("같은 메뉴 가게는 최대 8곳까지 보여 준다", async () => {
		answer({ 2000: { menu: Array.from({ length: 12 }, (_, i) => row("김치찌개 " + i, 100 + i * 100)) } });
		const found = await searchRestaurants(kimchiStew, [kimchiStew], origin);
		expect(found.others).toHaveLength(8);
	});

	test("이름으로 맞는 주력 가게를 업종으로만 맞는 가게보다 먼저 고른다", async () => {
		answer({ 2000: { menu: [row("BHC", 50, { category: "기타 간이/치킨" }), row("동네치킨", 300)] } });
		const found = await searchRestaurants(chicken, [chicken], origin);
		expect(found.pick.name).toBe("동네치킨");
		expect(names(found.others)).toEqual(["BHC"]);
		expect(found.othersSameMenu).toBe(true);
	});

	test("주력 가게가 한 곳뿐이면 넓은 말·넓은 업종 가게를 다른 곳으로 보여 준다", async () => {
		answer({ 2000: { menu: [row("김치찌개 A", 300), row("할매집", 80, { category: "한식/국/탕/찌개류" }), row("동네 찌개집", 50)] } });
		const found = await searchRestaurants(kimchiStew, [kimchiStew], origin);
		expect(found).toMatchObject({ mode: "menu", othersBroad: true });
		expect(found.pick.name).toBe("김치찌개 A");
		expect(names(found.others)).toEqual(["동네 찌개집", "할매집"]);
		expect(found.others[0].menuName).toBeUndefined();
	});

	test("주력 가게가 한 곳뿐이고 넓은 가게도 없으면 조건에 맞는 다른 메뉴 가게를 메뉴 이름과 함께 보여 준다", async () => {
		answer({ 2000: { menu: [row("김치찌개 A", 300)], filters: [row("김치찌개 A", 300), row("돈가스 클럽", 100), row("백반집", 10)] } });
		const found = await searchRestaurants(kimchiStew, [kimchiStew, tonkatsu], origin);
		expect(found.mode).toBe("menu");
		expect(found.others).toEqual([expect.objectContaining({ name: "돈가스 클럽", menuName: "돈가스" })]);
		expect(found.othersSameMenu).toBeUndefined();
	});

	test("넓은 말 가게만 있으면 broad 로 고르고 그 넓은 말을 알려 준다", async () => {
		answer({ 2000: { menu: [row("동네 찌개집", 100), row("엄마찌개", 200), row("의정부부대찌개", 10)] } });
		const found = await searchRestaurants(kimchiStew, [kimchiStew], origin);
		expect(found).toMatchObject({ mode: "broad", broadTerm: "찌개", broadCategory: null, searchedKm: 2 });
		expect(found.pick.name).toBe("동네 찌개집");
		expect(names(found.others)).toEqual(["엄마찌개"]);
	});

	test("넓은 업종으로만 맞으면 업종 이름을 알려 주고, 다른 넓은 가게가 없으면 조건 가게를 보여 준다", async () => {
		answer({ 2000: { menu: [row("할매집", 100, { category: "한식/국/탕/찌개류" })], filters: [row("돈가스 클럽", 300)] } });
		const found = await searchRestaurants(kimchiStew, [kimchiStew, tonkatsu], origin);
		expect(found).toMatchObject({ mode: "broad", broadTerm: null, broadCategory: "국/탕/찌개류" });
		expect(names(found.others)).toEqual(["돈가스 클럽"]);
	});

	test("메뉴 가게가 없으면 조건에 맞는 다른 메뉴 가게를 filter 로 고른다", async () => {
		answer({ 2000: { menu: [row("한식당", 100, { matched: false })], filters: [row("돈가스 클럽", 300), row("왕돈까스", 500)] } });
		const found = await searchRestaurants(kimchiStew, [kimchiStew, tonkatsu], origin);
		expect(found).toMatchObject({ mode: "filter", searchedKm: 2 });
		expect(found.pick).toMatchObject({ name: "돈가스 클럽", menuName: "돈가스" });
		expect(found.others).toEqual([expect.objectContaining({ name: "왕돈까스", menuName: "돈가스" })]);
	});

	test("같은 메뉴로 20m 안에 띄어쓰기만 다른 이름이 있으면 한 가게로 합친다", async () => {
		answer({ 2000: { menu: [
			row("종로 김치찌개", 100, { officialVisits: 5 }),
			row("종로김치찌개", 110, { address: "서울 종로구 1", officialVisits: 2 }),
			row("종로김치찌개", 140),
		] } });
		const found = await searchRestaurants(kimchiStew, [kimchiStew], origin);
		expect(found.pick).toMatchObject({ name: "종로김치찌개", distance: 110, address: "서울 종로구 1", officialVisits: 5 });
		expect(found.others.map((place) => place.distance)).toEqual([140]);
	});

	test("한쪽 이름에 한글이 없으면 20m 안의 같은 메뉴 가게를 하나로 합친다", async () => {
		const withEnglish = { ...tonkatsu, search_terms: ["돈가스", "donkatsu"] };
		answer({ 2000: { filters: [row("Donkatsu Club", 100), row("돈가스 클럽", 105, { address: "서울" }), row("돈가스 천국", 108)] } });
		const found = await searchRestaurants(kimchiStew, [withEnglish], origin);
		expect(found.mode).toBe("filter");
		// 두 이름 모두 한글이 든 가게는 20m 안이어도 이름이 서로 안 겹치면 따로 둬요.
		expect([found.pick, ...found.others].map(({ name, address }) => [name, address])).toEqual([["돈가스 클럽", "서울"], ["돈가스 천국", ""]]);
	});
});

describe("searchRestaurants: 5km 로 넓혀 찾기", () => {
	test("2km 안에 비슷한 가게뿐이고 5km 에서도 메뉴 가게가 없으면 2km 비슷한 가게를 고른다", async () => {
		// 비슷한 가게는 DB 가 돌려준 순서(가까운 순) 그대로 앞 3곳에서 골라요.
		const calls = answer({ 2000: { menu: [row("백반집", 50, { matched: false }), row("한식당", 100, { matched: false })] } });
		const found = await searchRestaurants(kimchiStew, [kimchiStew], origin);
		expect(found).toMatchObject({ mode: "similar", searchedKm: 5 });
		expect(found.wider).toBeUndefined();
		expect(found.pick.name).toBe("백반집");
		expect(names(found.others)).toEqual(["한식당"]);
		expect(calls.map((call) => call.params.p_radius)).toEqual([2000, 2000, 5000, 5000]);
		expect(calls[2].params.p_similar_amenities).toEqual([]);
	});

	test("5km 안에서 메뉴 가게를 찾으면 wider 로 돌려준다", async () => {
		answer({ 5000: { menu: [row("김치찌개 먼집", 4000)] } });
		const found = await searchRestaurants(kimchiStew, [kimchiStew], origin);
		expect(found).toMatchObject({ mode: "menu", wider: true, searchedKm: 5 });
		expect(found.pick.name).toBe("김치찌개 먼집");
	});

	test("아무 데도 없으면 none 이다", async () => {
		answer({});
		expect(await searchRestaurants(kimchiStew, [kimchiStew], origin)).toEqual({ mode: "none", pick: null, others: [], searchedKm: 5 });
	});

	test("5km 검색이 실패하면 2km 결과와 2km 로 돌려준다", async () => {
		answer({ 5000: { menu: new Error("timeout") } });
		expect(await searchRestaurants(kimchiStew, [kimchiStew], origin)).toEqual({ mode: "none", pick: null, others: [], searchedKm: 2 });
	});
});

describe("searchRestaurants: DB 대신 OpenStreetMap", () => {
	const realFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	test("DB 를 못 쓰면 Overpass 결과로 고르고 넓혀 찾지 않는다", async () => {
		let requests = 0;
		globalThis.fetch = async () => {
			requests += 1;
			return Response.json({ elements: [{ lat: 37.5, lon: 127, tags: { name: "한식당", amenity: "restaurant" } }] });
		};
		const found = await searchRestaurants(kimchiStew, [kimchiStew], origin);
		expect(found).toMatchObject({ mode: "similar", searchedKm: 2 });
		expect(found.pick.name).toBe("한식당");
		// 이름으로 찾기 1번, 비슷한 가게 찾기 1번
		expect(requests).toBe(2);
	});
});

describe("listRestaurants", () => {
	test("조건 메뉴를 주력으로 파는 가게만 메뉴 이름을 붙여 가까운 순으로 보여 준다", async () => {
		const calls = answer({ 2000: { menu: [row("돈가스 클럽", 300), row("동네 찌개집", 50), row("김치찌개 A", 100)] } });
		const found = await listRestaurants([kimchiStew, tonkatsu], origin);
		expect(found.wider).toBe(false);
		expect(found.searchedKm).toBe(2);
		expect(found.places.map(({ name, menuName }) => [name, menuName])).toEqual([["김치찌개 A", "김치찌개"], ["돈가스 클럽", "돈가스"]]);
		expect(calls[0].params).toMatchObject({ p_terms: ["김치찌개", "돈가스", "돈까스"], p_similar_amenities: [] });
	});

	test("최대 30곳까지 보여 준다", async () => {
		answer({ 2000: { menu: Array.from({ length: 35 }, (_, i) => row("돈가스 " + i, 35 - i)) } });
		const found = await listRestaurants([tonkatsu], origin);
		expect(found.places).toHaveLength(30);
		expect(found.places[0].name).toBe("돈가스 34");
	});

	test("2km 안에 없으면 5km 까지 넓히고, 거기도 없으면 빈 목록이다", async () => {
		answer({ 5000: { menu: [row("돈가스 클럽", 4000)] } });
		expect(await listRestaurants([tonkatsu], origin)).toMatchObject({ wider: true, searchedKm: 5, places: [{ name: "돈가스 클럽" }] });
		answer({});
		expect(await listRestaurants([tonkatsu], origin)).toEqual({ places: [], wider: true, searchedKm: 5 });
	});

	test("DB 오류는 다시 눌러 달라는 오류로 바꾸고 원래 오류를 cause 로 단다", async () => {
		const failure = new Error("rpc failed");
		answer({ 2000: { menu: failure } });
		const error = await listRestaurants([tonkatsu], origin).catch((caught) => caught);
		expect(error.message).toBe("가게 목록을 불러오지 못했어요. 잠시 후 다시 눌러 주세요.");
		expect(error.cause).toBe(failure);
	});
});
