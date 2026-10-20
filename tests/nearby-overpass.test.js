import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { searchOverpassForMenu } from "../js/nearby-overpass.js";

// fetch 를 고정 응답으로 바꿔서 실제 네트워크에 나가지 않아요.
const origin = { lat: 37.56651, lng: 126.97801 };
const kimchiStew = {
	name: "김치찌개",
	kinds: ["식사"],
	cuisine: "한식",
	search_terms: ["김치찌개", "찌개"],
	exclude_terms: ["부대찌개"],
};
const cake = { name: "케이크", kinds: ["간식"], cuisine: "양식", search_terms: ["케이크"] };

const realFetch = globalThis.fetch;
let requests;
let warn;

function serve(...responses) {
	requests = [];
	globalThis.fetch = async (url, options) => {
		const query = options.body.get("data");
		requests.push({ url, query });
		const next = responses.shift();
		if (next instanceof Error) {
			throw next;
		}
		return typeof next === "number"
			? new Response("", { status: next })
			: Response.json({ elements: next });
	};
}

const node = (name, lat, lon, tags = {}) => ({ lat, lon, tags: { name, amenity: "restaurant", ...tags } });

beforeEach(() => {
	warn = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	globalThis.fetch = realFetch;
	warn.mockRestore();
});

describe("searchOverpassForMenu", () => {
	test("이름이 메뉴 검색어에 맞는 가게만 matched 로 가까운 순으로 돌려준다", async () => {
		serve([
			node("먼 김치찌개", 37.5755, 126.97801, { phone: "+82 2 333 4444", "addr:city": "서울", "addr:street": "세종대로", "addr:housenumber": "1" }),
			{ center: { lat: 37.5674, lon: 126.97801 }, tags: { name: "가까운 찌개", amenity: "restaurant", "contact:phone": "02 555 6666" } },
			node("의정부부대찌개", 37.5666, 126.97801),
		]);
		expect(await searchOverpassForMenu(kimchiStew, origin)).toEqual([
			{ name: "가까운 찌개", amenity: "restaurant", shop: undefined, lat: 37.5674, lng: 126.97801, distance: 99, walkMinutes: 2, phone: "02-555-6666", address: "", matched: true },
			{ name: "먼 김치찌개", amenity: "restaurant", shop: undefined, lat: 37.5755, lng: 126.97801, distance: 1000, walkMinutes: 19, phone: "02-333-4444", address: "서울 세종대로 1", matched: true },
		]);
		expect(requests).toHaveLength(1);
	});

	test("메뉴 검색 질의에 2km 반경, 소수 넷째 자리 좌표, 검색어·가게 종류를 넣는다", async () => {
		serve([node("케이크 하우스", 37.5665, 126.978, { amenity: "cafe" })]);
		await searchOverpassForMenu(cake, origin);
		const around = "nwr(around:2000,37.5665,126.9780)";
		expect(requests[0].query).toBe(
			"[out:json][timeout:20];("
			+ around + "[\"amenity\"~\"^(cafe|ice_cream|fast_food|restaurant)$\"][\"name\"~\"케이크\",i];"
			+ around + "[\"shop\"~\"^(bakery|pastry|confectionery)$\"][\"name\"~\"케이크\",i];"
			+ ");out center tags 80;",
		);
	});

	test("이름으로 맞는 가게가 없으면 비슷한 가게(같은 요리 종류)를 matched 없이 돌려준다", async () => {
		serve([node("의정부부대찌개", 37.5666, 126.97801)], [node("한식당", 37.5666, 126.97801, { cuisine: "korean" })]);
		const result = await searchOverpassForMenu(kimchiStew, origin);
		expect(result.map(({ name, matched }) => ({ name, matched }))).toEqual([{ name: "한식당", matched: false }]);
		expect(requests[1].query).toBe(
			"[out:json][timeout:20];(nwr(around:2000,37.5665,126.9780)[\"amenity\"~\"^(restaurant|fast_food)$\"][\"cuisine\"~\"korean\",i][\"name\"];);out center tags 80;",
		);
	});

	test("첫 서버가 실패하면 다음 서버로 넘어간다", async () => {
		serve(503, [node("김치찌개", 37.5666, 126.97801)]);
		const result = await searchOverpassForMenu(kimchiStew, origin);
		expect(result.map((place) => place.name)).toEqual(["김치찌개"]);
		expect(requests.map((request) => request.url)).toEqual([
			"https://overpass-api.de/api/interpreter",
			"https://maps.mail.ru/osm/tools/overpass/api/interpreter",
		]);
	});

	test("모든 서버가 실패하면 마지막 오류를 cause 로 달아 다시 눌러 달라고 한다", async () => {
		const last = new Error("network down");
		serve(500, last);
		const error = await searchOverpassForMenu(kimchiStew, origin).catch((caught) => caught);
		expect(error.message).toBe("식당 정보를 불러오지 못했어요. 잠시 후 다시 눌러 주세요.");
		expect(error.cause).toBe(last);
	});
});
