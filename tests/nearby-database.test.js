import { beforeEach, describe, expect, test } from "bun:test";
import { useFakeRpc, useNoSupabase } from "./helpers/fake-supabase.js";
import { formatPhone, searchDatabase, walkMinutes } from "../js/nearby-database.js";

const origin = { lat: 37.5665, lng: 126.978 };
const kimchiStew = {
	name: "김치찌개",
	kinds: ["식사"],
	cuisine: "한식",
	search_terms: ["김치찌개", "찌개"],
	broad_terms: ["찌개"],
	broad_categories: ["한식/국/탕/찌개류"],
};
const cake = { name: "케이크", kinds: ["간식"], cuisine: "양식", search_terms: ["케이크", "찌개"], categories: ["카페/디저트"] };

describe("walkMinutes", () => {
	test("직선거리에 1.3을 곱해 분당 67m로 나눠 반올림한다", () => {
		expect(walkMinutes(1000)).toBe(19);
		expect(walkMinutes(2000)).toBe(39);
	});

	test("아주 가까워도 1분으로 적는다", () => {
		expect(walkMinutes(0)).toBe(1);
	});
});

describe("formatPhone", () => {
	test("+82 국가 번호를 0으로 바꾸고 공백·점을 하이픈으로 바꾼다", () => {
		expect(formatPhone("+82 2 123 4567")).toBe("02-123-4567");
		expect(formatPhone("+82-10.1234.5678")).toBe("010-1234-5678");
	});

	test("번호가 없으면 빈 글자다", () => {
		expect(formatPhone(undefined)).toBe("");
		expect(formatPhone(null)).toBe("");
	});
});

describe("searchDatabase", () => {
	beforeEach(useNoSupabase);

	test("메뉴들의 검색어·가게 종류·업종을 모아 nearby_places 를 부른다", async () => {
		const calls = useFakeRpc(() => ({ data: [], error: null }));
		await searchDatabase(origin, [kimchiStew, cake], { amenities: ["cafe"], cuisine: "korean" }, 5000);
		expect(calls).toEqual([{
			name: "nearby_places",
			params: {
				p_lat: 37.5665,
				p_lng: 126.978,
				p_radius: 5000,
				p_terms: ["김치찌개", "찌개", "케이크"],
				p_amenities: ["restaurant", "fast_food", "food_court", "cafe", "ice_cream"],
				p_shops: ["bakery", "pastry", "confectionery"],
				p_similar_amenities: ["cafe"],
				p_similar_cuisine: "korean",
				p_categories: ["한식/국/탕/찌개류", "카페/디저트"],
			},
		}]);
	});

	test("비슷한 가게를 찾지 않으면 빈 목록과 null 을 넘기고, 반경은 2km 가 기본이다", async () => {
		const calls = useFakeRpc(() => ({ data: [], error: null }));
		await searchDatabase(origin, [kimchiStew], null);
		expect(calls[0].params).toMatchObject({ p_radius: 2000, p_similar_amenities: [], p_similar_cuisine: null, p_shops: [] });
	});

	test("검색어·업종을 고르는 함수를 바꿔 넘길 수 있다", async () => {
		const calls = useFakeRpc(() => ({ data: [], error: null }));
		await searchDatabase(origin, [kimchiStew], null, 2000, () => ["x"], () => ["y"]);
		expect(calls[0].params).toMatchObject({ p_terms: ["x"], p_categories: ["y"] });
	});

	test("결과 줄을 가게 모양으로 바꾼다", async () => {
		useFakeRpc(() => ({
			data: [
				{ name: "종로 김치찌개", amenity: "restaurant", shop: null, lat: 37.57, lng: 126.98, distance: 500, phone: "+82 2 111 2222", address: "서울 종로구", matched: true, official_visits: 3, category: "한식/백반" },
				{ name: "찌개집", amenity: "restaurant", shop: null, lat: 37.56, lng: 126.97, distance: 10, phone: null, address: null, matched: false, official_visits: null, category: null },
			],
			error: null,
		}));
		expect(await searchDatabase(origin, [kimchiStew], null)).toEqual([
			{ name: "종로 김치찌개", amenity: "restaurant", shop: null, lat: 37.57, lng: 126.98, distance: 500, walkMinutes: 10, phone: "02-111-2222", address: "서울 종로구", matched: true, officialVisits: 3, category: "한식/백반" },
			{ name: "찌개집", amenity: "restaurant", shop: null, lat: 37.56, lng: 126.97, distance: 10, walkMinutes: 1, phone: "", address: "", matched: false, officialVisits: 0, category: null },
		]);
	});

	test("DB 오류는 그대로 던진다", async () => {
		const failure = new Error("rpc failed");
		useFakeRpc(() => ({ data: null, error: failure }));
		await expect(searchDatabase(origin, [kimchiStew], null)).rejects.toBe(failure);
	});

	test("Supabase 가 없으면 오류를 던진다", async () => {
		await expect(searchDatabase(origin, [kimchiStew], null)).rejects.toThrow("Supabase 가 연결되지 않았어요.");
	});
});
