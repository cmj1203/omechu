import { describe, expect, test } from "bun:test";
import {
	amenitiesFor,
	bestMenu,
	broadTermIn,
	categoryLabel,
	hasMainTerm,
	hasSearchTerm,
	isMainPlace,
	isMenuPlace,
	mainCategories,
	mainTerms,
	menuCategories,
	nameForMenu,
	searchTerms,
	shopsFor,
	similarFor,
} from "../js/nearby-menu-matching.js";

// data/menus.json 에 있는 메뉴와 같은 모양으로 줄여 적었어요.
const kimchiStew = {
	name: "김치찌개",
	kinds: ["식사"],
	cuisine: "한식",
	search_terms: ["김치찌개", "찌개", "Kimchi Jjigae"],
	exclude_terms: ["부대찌개"],
	broad_terms: ["찌개"],
	broad_categories: ["한식/국/탕/찌개류"],
};
const chicken = {
	name: "치킨",
	kinds: ["식사", "간식", "술"],
	cuisine: "한식",
	search_terms: ["치킨", "chicken", "통닭"],
	categories: ["기타 간이/치킨"],
};
const curry = {
	name: "커리",
	kinds: ["식사"],
	cuisine: "아시아",
	search_terms: ["커리", "카레", "인도"],
	exclude_terms: ["베이커리"],
	broad_terms: ["인도"],
};
const cake = { name: "케이크", kinds: ["간식"], cuisine: "양식", search_terms: ["케이크", "cake"] };
const beer = { name: "맥주", kinds: ["술"], cuisine: "양식" };

const place = (name, extra = {}) => ({ name, amenity: "restaurant", ...extra });

describe("searchTerms", () => {
	test("검색어가 없거나 빈 목록이면 메뉴 이름으로 찾는다", () => {
		expect(searchTerms(beer)).toEqual(["맥주"]);
		expect(searchTerms({ ...beer, search_terms: [] })).toEqual(["맥주"]);
	});

	test("정규식·SQL 특수 문자를 지우고, 지워서 빈 검색어는 버린다", () => {
		expect(searchTerms({ name: "x", search_terms: ["a.b|c", "(d)*", "%_", "e\"f"] })).toEqual(["abc", "d", "ef"]);
	});
});

describe("similarFor", () => {
	test("여러 종류에 드는 메뉴는 비슷한 가게 종류를 중복 없이 합친다", () => {
		expect(similarFor(chicken)).toEqual({
			amenities: ["restaurant", "fast_food", "cafe", "ice_cream", "bar", "pub", "biergarten"],
			cuisine: "korean",
		});
	});

	test("식사가 아닌 메뉴는 요리 종류(cuisine)로 좁히지 않는다", () => {
		expect(similarFor(cake)).toEqual({ amenities: ["cafe", "ice_cream"], cuisine: null });
	});

	test("요리 분류를 OSM cuisine 정규식으로 바꾼다", () => {
		expect(similarFor({ ...curry, cuisine: "일식" }).cuisine).toBe("japanese|sushi|ramen");
	});
});

describe("amenitiesFor / shopsFor", () => {
	test("여러 메뉴의 가게 종류를 중복 없이 합친다", () => {
		expect(amenitiesFor([kimchiStew, beer])).toEqual(["restaurant", "fast_food", "food_court", "bar", "pub", "biergarten"]);
	});

	test("간식 메뉴가 하나라도 있을 때만 빵집 종류를 더한다", () => {
		expect(shopsFor([kimchiStew, beer])).toEqual([]);
		expect(shopsFor([kimchiStew, cake])).toEqual(["bakery", "pastry", "confectionery"]);
	});
});

describe("nameForMenu", () => {
	test("가게 이름을 소문자로 바꾸고 제외어 부분을 공백으로 지운다", () => {
		expect(nameForMenu(place("아우어베이커리"), curry)).toBe("아우어 ");
		expect(nameForMenu(place("Kimchi House"), beer)).toBe("kimchi house");
	});
});

describe("검색어·주력 검색어", () => {
	test("mainTerms 는 넓은 말을 대소문자 상관없이 뺀다", () => {
		expect(mainTerms(kimchiStew)).toEqual(["김치찌개", "Kimchi Jjigae"]);
		expect(mainTerms({ ...curry, broad_terms: ["인도", "카레"] })).toEqual(["커리"]);
	});

	test("넓은 말만 든 이름은 검색어로는 맞지만 주력 검색어로는 안 맞는다", () => {
		expect(hasSearchTerm("엄마손 찌개", kimchiStew)).toBe(true);
		expect(hasMainTerm("엄마손 찌개", kimchiStew)).toBe(false);
	});

	test("검색어는 소문자로 바꾼 이름에서 찾는다", () => {
		expect(hasMainTerm("seoul kimchi jjigae", kimchiStew)).toBe(true);
	});

	test("메뉴 이름이 이름에 들어 있으면 검색어 목록에 없어도 맞는다", () => {
		expect(hasMainTerm("커리하우스", { ...curry, search_terms: ["카레"] })).toBe(true);
		expect(hasSearchTerm("커리하우스", { ...curry, search_terms: ["카레"] })).toBe(true);
	});

	test("broadTermIn 은 이름에 든 넓은 말을, 없으면 null 을 돌려준다", () => {
		expect(broadTermIn("동네 찌개집", kimchiStew)).toBe("찌개");
		expect(broadTermIn("김밥천국", kimchiStew)).toBeNull();
	});
});

describe("isMainPlace / isMenuPlace", () => {
	test("주력 검색어가 이름에 있으면 주력 가게다", () => {
		expect(isMainPlace(place("종로 김치찌개"), kimchiStew)).toBe(true);
	});

	test("이름에 메뉴 글자가 없어도 주력 업종이면 주력 가게다", () => {
		expect(isMainPlace(place("BHC", { category: "기타 간이/치킨" }), chicken)).toBe(true);
		expect(isMainPlace(place("BHC", { category: "한식/백반" }), chicken)).toBe(false);
	});

	test("넓은 업종은 메뉴 가게이지만 주력 가게는 아니다", () => {
		const stewShop = place("할매집", { category: "한식/국/탕/찌개류" });
		expect(isMenuPlace(stewShop, kimchiStew)).toBe(true);
		expect(isMainPlace(stewShop, kimchiStew)).toBe(false);
	});

	test("넓은 말만 든 이름은 메뉴 가게이지만 주력 가게는 아니다", () => {
		expect(isMenuPlace(place("동네 찌개집"), kimchiStew)).toBe(true);
		expect(isMainPlace(place("동네 찌개집"), kimchiStew)).toBe(false);
	});

	test("이름에 제외어가 든 가게는 업종이 맞아도 잡지 않는다", () => {
		const budae = place("의정부부대찌개", { category: "한식/국/탕/찌개류" });
		expect(isMenuPlace(budae, kimchiStew)).toBe(false);
		expect(isMainPlace(place("부대찌개 BHC", { category: "기타 간이/치킨" }), { ...chicken, exclude_terms: ["부대찌개"] })).toBe(false);
	});

	test("이름에 대문자가 있어도 제외어가 없으면 업종으로 잡는다", () => {
		expect(isMainPlace(place("BBQ", { category: "기타 간이/치킨" }), { ...chicken, exclude_terms: ["부대찌개"] })).toBe(true);
	});
});

describe("업종 목록", () => {
	test("mainCategories 는 주력 업종만, menuCategories 는 넓은 업종까지 중복 없이 모은다", () => {
		const chickenAgain = { ...chicken, name: "통닭" };
		expect(mainCategories([kimchiStew, chicken, chickenAgain])).toEqual(["기타 간이/치킨"]);
		expect(menuCategories([kimchiStew, chicken, chickenAgain])).toEqual(["한식/국/탕/찌개류", "기타 간이/치킨"]);
	});

	test("categoryLabel 은 대분류를 떼고, 업종이 없으면 null 이다", () => {
		expect(categoryLabel("한식/국/탕/찌개류")).toBe("국/탕/찌개류");
		expect(categoryLabel(undefined)).toBeNull();
	});
});

describe("bestMenu", () => {
	test("가게 종류(amenity)가 메뉴 종류에 맞지 않으면 고르지 않는다", () => {
		expect(bestMenu(place("치킨 카페", { amenity: "cafe" }), [kimchiStew], null)).toBeNull();
		expect(bestMenu(place("치킨 펍", { amenity: "pub" }), [chicken], null)).toBe(chicken);
	});

	test("간식 메뉴는 빵집(shop) 가게에도 맞는다", () => {
		expect(bestMenu({ name: "케이크 공방", shop: "pastry" }, [cake], null)).toBe(cake);
		expect(bestMenu({ name: "케이크 공방", shop: "pastry" }, [kimchiStew], null)).toBeNull();
	});

	test("주력 가게가 아니면 고르지 않는다", () => {
		expect(bestMenu(place("동네 찌개집"), [kimchiStew], null)).toBeNull();
	});

	test("메뉴 이름이 그대로 든 메뉴 > 다른 검색어로 맞은 메뉴 > 업종으로만 맞은 메뉴 순으로 고른다", () => {
		const tongdak = { ...chicken, name: "통닭", search_terms: ["통닭", "치킨"] };
		const shop = place("옛날통닭", { category: "기타 간이/치킨" });
		// 치킨: '통닭' 검색어로 1점, 통닭: 이름 그대로 2점
		expect(bestMenu(shop, [chicken, tongdak], null)).toBe(tongdak);
		// 업종으로만 맞는 메뉴(0.5점)는 검색어로 맞는 메뉴(1점)에 진다
		const byCategory = { ...chicken, name: "닭강정", search_terms: ["닭강정"] };
		expect(bestMenu(shop, [byCategory, chicken], null)).toBe(chicken);
	});

	test("점수가 같으면 추천 메뉴를, 추천 메뉴가 없으면 먼저 온 메뉴를 고른다", () => {
		const tongdak = { ...chicken, name: "통닭", search_terms: ["통닭"] };
		const shop = place("BHC", { category: "기타 간이/치킨" });
		expect(bestMenu(shop, [chicken, tongdak], null)).toBe(chicken);
		expect(bestMenu(shop, [chicken, tongdak], tongdak)).toBe(tongdak);
	});
});
