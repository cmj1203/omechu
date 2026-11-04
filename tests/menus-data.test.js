import { describe, expect, test } from "bun:test";
import { AMENITIES_BY_KIND, CUISINE_TAGS, searchTerms } from "../js/nearby-menu-matching.js";
import { similarLabel } from "../js/nearby-renderer.js";

// Supabase 를 못 쓸 때 쓰는 기본 메뉴 목록이에요. 메뉴를 고치다 모양이 틀어지면 여기서 걸려요.
const menus = await Bun.file(new URL("../data/menus.json", import.meta.url)).json();

describe("data/menus.json", () => {
	test("메뉴 이름이 겹치지 않는다", () => {
		const names = menus.map((menu) => menu.name);
		expect(names.length).toBeGreaterThan(0);
		expect(new Set(names).size).toBe(names.length);
	});

	test("모든 메뉴의 종류(kinds)·요리 분류(cuisine)가 검색 코드가 아는 값이다", () => {
		const bad = menus.filter((menu) => menu.kinds.length === 0
			|| !menu.kinds.every((kind) => kind in AMENITIES_BY_KIND)
			|| !(menu.cuisine in CUISINE_TAGS));
		expect(bad.map((menu) => menu.name)).toEqual([]);
	});

	test("모든 메뉴가 특수 문자를 지운 뒤에도 검색어를 하나 이상 갖는다", () => {
		expect(menus.filter((menu) => searchTerms(menu).length === 0).map((menu) => menu.name)).toEqual([]);
	});

	test("넓은 말(broad_terms)은 모두 그 메뉴의 검색어에 들어 있다", () => {
		const bad = menus.filter((menu) => (menu.broad_terms ?? []).some((term) => !searchTerms(menu).includes(term)));
		expect(bad.map((menu) => menu.name)).toEqual([]);
	});
});

describe("similarLabel", () => {
	test("식사 메뉴는 요리 분류로, 간식은 카페·디저트, 술만 있으면 술집으로 적는다", () => {
		expect(similarLabel({ kinds: ["식사", "술"], cuisine: "한식" })).toBe("한식당");
		expect(similarLabel({ kinds: ["식사"], cuisine: "아시아" })).toBe("아시아 음식점");
		expect(similarLabel({ kinds: ["간식", "술"], cuisine: "양식" })).toBe("카페·디저트 가게");
		expect(similarLabel({ kinds: ["술"], cuisine: "한식" })).toBe("술집");
	});
});
