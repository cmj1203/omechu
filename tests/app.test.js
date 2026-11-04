import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { freshImport, loadPage, settle } from "./helpers/dom.js";
import "./helpers/fake-kakao.js";
import { useFakeSupabase, useNoSupabase } from "./helpers/fake-supabase.js";
import { excludedMenus } from "../js/member.js";

// js/app.js 는 불러올 때 바로 index.html 화면을 채우는 진입 모듈이에요. 시험마다 화면을 새로 넣고 모듈을 새로 불러와요.
// 메뉴·추천 식당은 가짜 Supabase(menus 표, nearby_places RPC)로 주고, 위치 권한은 꺼 둬서 추천만으로는 식당을 찾지 않게 해요.
const menu = (name, kinds, cuisine, staple = null, extra = {}) => ({
	name,
	kinds,
	cuisine,
	staple,
	search_terms: [name],
	exclude_terms: [],
	broad_terms: [],
	categories: [],
	broad_categories: [],
	...extra,
});

const MENUS = [
	menu("김치찌개", ["식사"], "한식", "밥", { search_terms: ["김치찌개", "찌개"], broad_terms: ["찌개"] }),
	menu("잔치국수", ["식사"], "한식", "면"),
	menu("비빔국수", ["식사"], "한식", "면"),
	menu("짜장면", ["식사"], "중식", "면"),
	menu("초밥", ["식사"], "일식", "밥"),
	menu("쌀국수", ["식사"], "아시아", "면"),
	menu("케이크", ["간식"], "양식"),
	menu("맥주", ["술"], "양식"),
];

const user = { id: "u1", email: "a@b.c" };
let restores = [];
let random;
let nearbyRows;

// navigator·Element 같은 전역 자리를 잠시 바꾸고 afterEach 에서 되돌려요.
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

function fakeDatabase({ menus = MENUS } = {}) {
	return useFakeSupabase({
		session: { user },
		tables: {
			menus: { data: menus, error: null },
			excluded_menus: { data: [], error: null },
			favorite_places: { data: [], error: null },
		},
		rpc: {
			nearby_places: () => ({ data: nearbyRows, error: null }),
		},
	});
}

async function openApp(search = "") {
	await loadPage("index.html", search);
	await freshImport("js/app.js");
	await settle();
}

const $ = (id) => document.getElementById(id);
const form = () => $("filters");
const resultText = () => [...$("result").children].map((node) => node.textContent);
const menuName = () => $("result").querySelector(".menu-name")?.textContent;

function choose(name, value) {
	const input = form().querySelector("input[name='" + name + "'][value='" + value + "']");
	input.checked = true;
	form().dispatchEvent(new Event("change", { bubbles: true }));
}

function recommend() {
	form().requestSubmit();
}

// 구글 평점 SDK 는 받지 않고, 붙인 스크립트를 보면 콜백만 불러요. 평점은 '못 찾음'으로 답해요.
window.google ??= { maps: { importLibrary: async () => ({ Place: { searchByText: async () => ({ places: [] }) } }) } };
new MutationObserver((records) => {
	for (const record of records) {
		for (const node of record.addedNodes) {
			if (node.src?.startsWith("https://maps.googleapis.com/")) {
				queueMicrotask(() => window.omechuGoogleMapsReady?.());
			}
		}
	}
}).observe(document.head, { childList: true });

// member.js 의 기본 제외 메뉴는 한 프로세스에서 한 번만 불러와 함께 써요. 로그인한 채로 먼저 불러 두면 Set 이라 시험마다 비우고 채울 수 있어요.
fakeDatabase();
const memberExcluded = await excludedMenus();

beforeEach(() => {
	restores = [];
	nearbyRows = [];
	memberExcluded?.clear();
	fakeDatabase();
	override(navigator, "permissions", { query: async () => ({ state: "prompt" }) });
	random = spyOn(Math, "random").mockReturnValue(0);
	spyOn(console, "warn").mockImplementation(() => {});
	spyOn(console, "error").mockImplementation(() => {});
	try {
		localStorage.clear();
	} catch {
		// 저장소가 없으면 그대로 둬요.
	}
});

afterEach(() => {
	for (const restore of restores.reverse()) {
		restore();
	}
	random.mockRestore();
	console.warn.mockRestore();
	console.error.mockRestore();
});

describe("처음 열기", () => {
	test("메뉴를 불러오면 추천 단추·검색 칸을 켜고, 결과 상자에 메뉴 이름을 흘려 보낸다", async () => {
		await openApp();
		expect($("recommend").disabled).toBe(false);
		expect($("recommend").textContent).toBe("추천받기");
		expect($("storeQuery").disabled).toBe(false);
		expect($("menuQuery").disabled).toBe(false);
		expect($("result").closest(".result-box").hidden).toBe(false);
		expect($("dataNote").hidden).toBe(true);
		const slot = $("result").querySelector(".slot.is-idle");
		const names = [...slot.querySelectorAll(".slot-item")].map((item) => item.textContent);
		// 메뉴 8개를 섞어 두 번 이어 붙여요.
		expect(names).toHaveLength(16);
		expect(names.slice(0, 8)).toEqual(names.slice(8));
		expect(new Set(names)).toEqual(new Set(MENUS.map((item) => item.name)));
		expect(slot.style.getPropertyValue("--slot-count")).toBe("8");
		expect($("pollLink").hidden).toBe(true);
	});

	test("흘려 보내는 메뉴는 12개까지다", async () => {
		fakeDatabase({ menus: Array.from({ length: 20 }, (_, index) => menu("메뉴" + index, ["식사"], "한식")) });
		await openApp();
		expect($("result").querySelectorAll(".slot-item")).toHaveLength(24);
	});

	test("DB 에 메뉴가 없으면 기본 메뉴 목록(data/menus.json)으로 추천하고 그렇다고 알린다", async () => {
		fakeDatabase({ menus: [] });
		const fetch = spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(MENUS.slice(0, 2)), { status: 200 }));
		try {
			await openApp();
			expect(fetch.mock.calls[0][0]).toBe("data/menus.json");
			expect($("dataNote").hidden).toBe(false);
			expect($("dataNote").textContent).toBe("지금은 기본 메뉴 목록으로 추천하고 있어요.");
			expect($("recommend").disabled).toBe(false);
		} finally {
			fetch.mockRestore();
		}
	});

	test("기본 메뉴 목록도 못 받으면 단추를 끈 채 다시 열라고 안내한다", async () => {
		useNoSupabase();
		const fetch = spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
		try {
			await openApp();
			expect($("recommend").disabled).toBe(true);
			expect($("recommend").textContent).toBe("메뉴를 불러오지 못했어요");
			expect(resultText()).toEqual(["잠시 후 새로고침해 주세요."]);
			expect($("storeQuery").disabled).toBe(true);
		} finally {
			fetch.mockRestore();
		}
	});
});

describe("메뉴 추천", () => {
	test("추천하면 메뉴 이름·종류·나라와 '메뉴 빼기', 같이 정하기 링크를 보여 준다", async () => {
		await openApp();
		recommend();
		expect(menuName()).toBe("김치찌개");
		expect($("result").querySelector(".menu-tags").textContent).toBe("식사 | 한식");
		expect($("result").querySelector(".menu-actions button").textContent).toBe("메뉴 빼기");
		expect($("recommend").textContent).toBe("다시 추천받기");
		expect($("pollLink").hidden).toBe(false);
		// 같은 조건의 다른 메뉴 2개를 더해요.
		const menus = new URL($("pollLink").href).searchParams.get("menus").split(",");
		expect(menus).toHaveLength(3);
		expect(menus[0]).toBe("김치찌개");
		expect(new Set(menus).size).toBe(3);
	});

	test("최근에 나온 메뉴는 피하고, 조건 메뉴가 모두 최근에 나왔으면 바로 전 메뉴만 피한다", async () => {
		await openApp();
		choose("kind", "식사");
		choose("cuisine", "한식");
		const picked = [];
		for (let i = 0; i < 4; i += 1) {
			recommend();
			picked.push(menuName());
		}
		expect(picked).toEqual(["김치찌개", "잔치국수", "비빔국수", "김치찌개"]);
	});

	test("최근 기록은 5개까지라, 여섯 번째 전 메뉴는 다시 나올 수 있다", async () => {
		await openApp();
		choose("kind", "식사");
		const picked = [];
		for (let i = 0; i < 7; i += 1) {
			recommend();
			picked.push(menuName());
		}
		// 식사 6개: 다섯 개가 최근 목록에 있으면 남은 하나, 그다음은 5개 밖으로 밀린 첫 메뉴예요.
		expect(picked).toEqual(["김치찌개", "잔치국수", "비빔국수", "짜장면", "초밥", "쌀국수", "김치찌개"]);
	});

	test("조건에 맞는 메뉴가 하나뿐이면 그 메뉴를 다시 보여 준다", async () => {
		await openApp();
		choose("kind", "간식");
		recommend();
		recommend();
		expect(menuName()).toBe("케이크");
	});

	test("조건에 맞는 메뉴가 없으면 안내하고 주변 식당 칸을 숨긴다", async () => {
		await openApp();
		choose("kind", "식사");
		choose("staple", "밥");
		choose("cuisine", "아시아");
		recommend();
		expect(resultText()).toEqual(["조건에 맞는 메뉴가 없어요. 조건을 바꿔 보세요."]);
		expect($("nearby").hidden).toBe(true);
		expect($("pollLink").hidden).toBe(true);
	});

	test("추천 단추로 추천하면 슬롯을 돌린 뒤 멈추면 고른 메뉴를 보여 준다", async () => {
		const spins = [];
		override(Element.prototype, "animate", function animate(keyframes, options) {
			const animation = { keyframes, options, onfinish: null };
			spins.push(animation);
			return animation;
		});
		await openApp();
		form().requestSubmit($("recommend"));
		expect(menuName()).toBeUndefined();
		const items = [...$("result").querySelectorAll(".slot-item")].map((item) => item.textContent);
		// 앞 14줄, 고른 메뉴, 한 줄 더
		expect(items).toHaveLength(16);
		expect(items[14]).toBe("김치찌개");
		expect(spins).toHaveLength(1);
		expect(spins[0].options.duration).toBe(1200);
		spins[0].onfinish();
		expect(menuName()).toBe("김치찌개");
	});

	test("돌던 슬롯이 멈추기 전에 다른 결과가 나오면 멈춘 뒤 덮어쓰지 않는다", async () => {
		const spins = [];
		override(Element.prototype, "animate", function animate() {
			const animation = { onfinish: null };
			spins.push(animation);
			return animation;
		});
		await openApp();
		form().requestSubmit($("recommend"));
		choose("kind", "식사");
		choose("staple", "밥");
		choose("cuisine", "아시아");
		spins[0].onfinish();
		expect(resultText()).toEqual(["조건에 맞는 메뉴가 없어요. 조건을 바꿔 보세요."]);
	});

	test("움직임 줄이기를 켠 기기에서는 슬롯을 돌리지 않는다", async () => {
		override(window, "matchMedia", (query) => ({ matches: query === "(prefers-reduced-motion: reduce)" }));
		const animate = spyOn(Element.prototype, "animate");
		try {
			await openApp();
			form().requestSubmit($("recommend"));
			expect(menuName()).toBe("김치찌개");
			expect(animate).not.toHaveBeenCalled();
		} finally {
			animate.mockRestore();
		}
	});

	test("추천 뒤 조건을 바꾸면 바로 다시 추천하고, 추천 전이면 흘려 보내는 메뉴만 바꾼다", async () => {
		await openApp();
		choose("kind", "술");
		expect(menuName()).toBeUndefined();
		expect([...new Set([...$("result").querySelectorAll(".slot-item")].map((item) => item.textContent))]).toEqual(["맥주"]);
		choose("kind", "식사");
		recommend();
		choose("cuisine", "중식");
		expect(menuName()).toBe("짜장면");
	});
});

describe("나라·밥면 조건 잠금", () => {
	const cuisines = () => [...form().elements.cuisine];

	test("처음에는 식사가 아니라서 밥·면 칸을 숨기고 끈다", async () => {
		await openApp();
		expect($("stapleChoice").hidden).toBe(true);
		expect($("stapleChoice").disabled).toBe(true);
	});

	test("간식·술을 고르면 나라를 '전체'로 고정하고 다른 나라를 끈다", async () => {
		await openApp();
		choose("cuisine", "한식");
		choose("kind", "간식");
		expect(form().elements.cuisine.value).toBe("전체");
		expect(cuisines().filter((option) => option.disabled).map((option) => option.value)).toEqual(["한식", "중식", "일식", "양식", "아시아"]);
		choose("kind", "술");
		expect(cuisines().some((option) => option.value !== "전체" && !option.disabled)).toBe(false);
	});

	test("식사로 돌아오면 나라를 다시 고를 수 있고 밥·면 칸이 보인다", async () => {
		await openApp();
		choose("kind", "간식");
		choose("kind", "식사");
		expect(cuisines().every((option) => !option.disabled)).toBe(true);
		expect($("stapleChoice").hidden).toBe(false);
		expect($("stapleChoice").disabled).toBe(false);
	});

	test("식사에서 면을 고른 뒤 다른 종류로 바꾸면 밥·면을 '전체'로 돌린다", async () => {
		await openApp();
		choose("kind", "식사");
		choose("staple", "면");
		choose("kind", "전체");
		expect(form().elements.staple.value).toBe("전체");
		expect($("stapleChoice").hidden).toBe(true);
	});

	test("뒤로 가기로 돌아와(pageshow) 되살린 값에도 잠금을 맞춘다", async () => {
		await openApp();
		form().querySelector("input[name=kind][value='술']").checked = true;
		window.dispatchEvent(new Event("pageshow"));
		expect(cuisines().find((option) => option.value === "한식").disabled).toBe(true);
	});

	test("밥·면 조건으로 메뉴를 거른다", async () => {
		await openApp();
		choose("kind", "식사");
		choose("staple", "면");
		choose("cuisine", "한식");
		recommend();
		expect(menuName()).toBe("잔치국수");
	});
});

describe("메뉴 빼기·다시 넣기", () => {
	const skippedNames = () => [...$("skippedMenus").querySelectorAll(".skipped-menu-name")].map((item) => item.textContent);

	test("'메뉴 빼기'를 누르면 뺀 메뉴 목록에 넣고 다른 메뉴를 추천한다", async () => {
		await openApp();
		choose("kind", "식사");
		choose("cuisine", "한식");
		recommend();
		$("result").querySelector(".menu-actions button").click();
		expect(skippedNames()).toEqual(["김치찌개"]);
		expect($("skippedMenus").hidden).toBe(false);
		expect($("skippedMenus").querySelector("summary").textContent).toBe("뺀 메뉴 전체 보기 (1)");
		expect(menuName()).toBe("잔치국수");
	});

	test("조건의 메뉴를 모두 빼면 안내하고, 다시 넣으면 바로 그 메뉴를 추천한다", async () => {
		await openApp();
		choose("kind", "간식");
		recommend();
		$("result").querySelector(".menu-actions button").click();
		expect(resultText()[0]).toBe("이 조건의 메뉴를 모두 뺐어요.");
		// 기본으로 뺀 메뉴가 없으면 내 계정 링크는 없어요.
		expect($("result").querySelector(".skipped-note").textContent).toBe("");
		expect($("nearby").hidden).toBe(true);
		$("skippedMenus").querySelector(".skipped-restore").click();
		expect(menuName()).toBe("케이크");
		expect($("skippedMenus").hidden).toBe(true);
		expect($("skippedMenus").open).toBe(false);
		// 목록이 비었으면 추천 결과의 '메뉴 빼기'로 초점을 옮겨요.
		expect(document.activeElement).toBe($("result").querySelector(".menu-actions button"));
	});

	test("뺀 메뉴가 여럿이면 다시 넣은 자리의 다음 단추로 초점을 옮긴다", async () => {
		await openApp();
		choose("kind", "식사");
		choose("cuisine", "한식");
		recommend();
		$("result").querySelector(".menu-actions button").click();
		$("result").querySelector(".menu-actions button").click();
		expect(skippedNames()).toEqual(["김치찌개", "잔치국수"]);
		$("skippedMenus").querySelectorAll(".skipped-restore")[0].click();
		expect(skippedNames()).toEqual(["잔치국수"]);
		expect(document.activeElement).toBe($("skippedMenus").querySelector(".skipped-restore"));
		// 추천 결과가 남아 있으면 다시 넣어도 새로 추천하지 않아요.
		expect(menuName()).toBe("비빔국수");
	});

	test("내 계정의 기본 제외 메뉴는 추천과 흘려 보내는 메뉴에서 빠진다", async () => {
		expect(memberExcluded).toBeInstanceOf(Set);
		memberExcluded.add("김치찌개");
		await openApp();
		const idle = new Set([...$("result").querySelectorAll(".slot-item")].map((item) => item.textContent));
		expect(idle.has("김치찌개")).toBe(false);
		recommend();
		expect(menuName()).toBe("잔치국수");
	});

	test("기본 제외 메뉴 때문에 남은 메뉴가 없으면 내 계정에서 바꾸라고 알린다", async () => {
		memberExcluded.add("케이크");
		await openApp();
		choose("kind", "간식");
		recommend();
		const note = $("result").querySelector(".skipped-note");
		expect(note.textContent).toBe("기본으로 뺀 메뉴 1개내 계정에서 바꾸기");
		expect(note.querySelector("a").getAttribute("href")).toBe("account.html");
	});
});

describe("메뉴 검색·가게 검색", () => {
	function search(formId, inputId, text) {
		$(inputId).value = text;
		$(formId).requestSubmit();
	}

	test("메뉴 검색은 띄어쓰기를 무시하고 이름이 같은 메뉴를 찾는다", async () => {
		await openApp();
		search("menuSearch", "menuQuery", "김치 찌개");
		expect(resultText()).toEqual(["메뉴 검색", "김치찌개"]);
		expect($("nearby").hidden).toBe(false);
	});

	test("같은 이름이 없으면 이름에 그 말이 든 메뉴들을 찾는다", async () => {
		await openApp();
		search("menuSearch", "menuQuery", "국수");
		expect(resultText()).toEqual(["메뉴 검색", "잔치국수, 비빔국수, 쌀국수"]);
	});

	test("맞는 메뉴가 없으면 안내하고 주변 식당 칸을 숨긴다", async () => {
		await openApp();
		search("menuSearch", "menuQuery", "피자");
		expect(resultText()).toEqual(["'피자' 메뉴가 없어요."]);
		expect($("nearby").hidden).toBe(true);
	});

	test("빈 칸으로 검색하면 아무것도 바꾸지 않고 칸에 초점을 둔다", async () => {
		await openApp();
		const before = $("result").innerHTML;
		search("menuSearch", "menuQuery", "  ");
		search("storeSearch", "storeQuery", "");
		expect($("result").innerHTML).toBe(before);
		expect(document.activeElement).toBe($("storeQuery"));
	});

	test("가게 검색은 친 말을 그대로 보여 주고, 메뉴 검색 뒤 조건을 바꿔도 다시 추천하지 않는다", async () => {
		await openApp();
		search("storeSearch", "storeQuery", "스타벅스");
		expect(resultText()).toEqual(["가게 검색", "스타벅스"]);
		choose("kind", "식사");
		expect(resultText()).toEqual(["가게 검색", "스타벅스"]);
	});
});

describe("같이 정하기에서 돌아오기(index.html?menu=…)", () => {
	test("메뉴·모일 곳·좌표가 오면 그 메뉴를 보여 주고 위치 칸에 모일 곳을 넣는다", async () => {
		await openApp("?menu=" + encodeURIComponent("짜장면") + "&place=" + encodeURIComponent("시청역") + "&lat=37.5&lng=126.9");
		expect(menuName()).toBe("짜장면");
		expect($("recommend").textContent).toBe("다시 추천받기");
		expect($("nearbyPlace").value).toBe("시청역");
		const menus = new URL($("pollLink").href).searchParams.get("menus");
		expect(menus).toBe("짜장면");
	});

	test("좌표가 빈 글자거나 숫자가 아니면 모일 곳을 넣지 않는다", async () => {
		await openApp("?menu=" + encodeURIComponent("짜장면") + "&place=" + encodeURIComponent("시청역") + "&lat=&lng=");
		expect($("nearbyPlace").value).toBe("");
		await openApp("?menu=" + encodeURIComponent("짜장면") + "&place=" + encodeURIComponent("시청역") + "&lat=abc&lng=126.9");
		expect($("nearbyPlace").value).toBe("");
		expect(menuName()).toBe("짜장면");
	});

	test("메뉴 이름이 비어 있으면 평소처럼 연다", async () => {
		await openApp("?menu=%20");
		expect($("result").querySelector(".slot.is-idle")).not.toBeNull();
	});
});

describe("'친구랑 같이 정하기' 링크", () => {
	const linkParams = () => new URL($("pollLink").href).searchParams;

	test("누르면 위치 칸 글자를 모일 곳으로 붙이고, 좌표·식당을 모르면 빼고 넘긴다", async () => {
		await openApp();
		recommend();
		$("nearbyPlace").value = " 강남역 ";
		$("pollLink").dispatchEvent(new MouseEvent("click", { cancelable: true }));
		expect(linkParams().get("place")).toBe("강남역");
		expect(linkParams().has("lat")).toBe(false);
		expect(linkParams().has("restaurant")).toBe(false);
	});

	test("위치 칸이 비어 있으면 모일 곳을 넘기지 않는다", async () => {
		await openApp();
		recommend();
		$("pollLink").dispatchEvent(new MouseEvent("click", { cancelable: true }));
		expect([...linkParams().keys()]).toEqual(["menus"]);
	});

	test("좌표를 아는 모일 곳과 보여 주는 추천 식당을 함께 넘기고, 빈 주소·전화는 null 로 적는다", async () => {
		nearbyRows = [{ name: "북경 짜장면", amenity: "restaurant", shop: null, lat: 37.5005, lng: 126.9, distance: 60, phone: null, address: null, matched: true, official_visits: null, category: null }];
		await openApp("?menu=" + encodeURIComponent("짜장면") + "&place=" + encodeURIComponent("시청역") + "&lat=37.5&lng=126.9");
		await settle(20);
		expect($("nearbyResult").querySelector(".restaurant-card")).not.toBeNull();
		$("pollLink").dispatchEvent(new MouseEvent("click", { cancelable: true }));
		expect(linkParams().get("place")).toBe("시청역");
		expect(linkParams().get("lat")).toBe("37.5");
		expect(linkParams().get("lng")).toBe("126.9");
		expect(JSON.parse(linkParams().get("restaurant"))).toEqual({
			key: "북경 짜장면|37.50050|126.90000",
			name: "북경 짜장면",
			address: null,
			phone: null,
			lat: 37.5005,
			lng: 126.9,
		});
	});
});
