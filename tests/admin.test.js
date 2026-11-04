import { loadPage, freshImport, settle } from "./helpers/dom.js";
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { failSupabase, setConfigured, useFakeSupabase } from "./helpers/fake-supabase.js";

// admin.js 는 불러올 때 바로 도는 화면 모듈이라, 시험마다 admin.html 을 넣고 새로 불러와요.
const user = { id: "admin1", email: "admin@example.com" };
const kimchi = { id: 1, name: "김치찌개", kinds: ["식사"], cuisine: "한식", search_terms: ["김치찌개", "찌개"], exclude_terms: ["부대찌개"] };
const cake = { id: 2, name: "케이크", kinds: ["간식"], cuisine: "양식", search_terms: ["케이크"], exclude_terms: [] };

const $ = (id) => document.getElementById(id);
let originalConfirm;

beforeEach(() => {
	originalConfirm = globalThis.confirm;
});

afterEach(() => {
	globalThis.confirm = originalConfirm;
	jest.useRealTimers();
});

function op(query, name) {
	return query.ops.find(([method]) => method === name);
}

function fakeTables(overrides = {}) {
	return {
		admins: { data: { user_id: "admin1" }, error: null },
		menus: (query) => (op(query, "select") ? { data: [kimchi, cake], error: null } : { error: null }),
		hidden_places: (query) => (op(query, "select") ? { data: [], error: null } : { error: null }),
		closure_reports: (query) => (op(query, "select") ? { data: [], error: null } : { error: null }),
		places: { data: [], error: null },
		...overrides,
	};
}

async function open({ session = { user }, tables = {}, rpc = {}, auth = {} } = {}) {
	const calls = useFakeSupabase({ session, auth, rpc, tables: fakeTables(tables) });
	await loadPage("admin.html");
	await freshImport("js/admin.js");
	await settle();
	return calls;
}

// required 검사를 건너뛰고 화면 코드의 검사를 보려고 submit 이벤트를 바로 보내요.
function submit(form) {
	form.dispatchEvent(new Event("submit", { cancelable: true }));
	return settle();
}

function setMenuForm({ name = "", kinds = ["식사"], cuisine = "한식", terms = "", excludes = "" }) {
	const form = $("menuForm");
	form.elements.namedItem("name").value = name;
	for (const box of form.querySelectorAll("input[name=kinds]")) {
		box.checked = kinds.includes(box.value);
	}
	form.elements.namedItem("cuisine").value = cuisine;
	form.elements.namedItem("search_terms").value = terms;
	form.elements.namedItem("exclude_terms").value = excludes;
}

const rowNames = () => [...$("menuRows").querySelectorAll("tr")].map((row) => row.firstElementChild.textContent);
const buttonIn = (container, label) => [...container.querySelectorAll("button")].find((button) => button.textContent === label);

describe("처음 열 때", () => {
	test("Supabase 설정이 없으면 안내만 보여 준다", async () => {
		setConfigured(false);
		try {
			useFakeSupabase();
			await loadPage("admin.html");
			await freshImport("js/admin.js");
		} finally {
			setConfigured(true);
		}
		expect($("adminNotice").hidden).toBe(false);
		expect($("adminNotice").textContent).toBe("아직 Supabase가 연결되지 않았어요. js/supabase.js 에 프로젝트 주소와 공개 키를 넣어 주세요.");
		expect($("loginForm").hidden).toBe(true);
	});

	test("Supabase 에 연결하지 못하면 안내한다", async () => {
		failSupabase(new Error("CDN 막힘"));
		await loadPage("admin.html");
		await freshImport("js/admin.js");
		expect($("adminNotice").textContent).toBe("Supabase에 연결하지 못했어요: CDN 막힘");
		expect($("loginForm").hidden).toBe(true);
	});

	test("로그인하지 않았으면 로그인 칸만 보여 준다", async () => {
		await open({ session: null });
		expect($("loginForm").hidden).toBe(false);
		expect($("manager").hidden).toBe(true);
	});

	test("관리자가 아니면 로그인 칸을 숨기고 내 계정으로 안내한다", async () => {
		await open({ tables: { admins: { data: null, error: null } } });
		expect($("loginForm").hidden).toBe(true);
		expect($("manager").hidden).toBe(true);
		expect($("adminNotice").textContent).toBe("관리자 권한이 없는 계정이에요. 즐겨찾기는 '내 계정'에서 볼 수 있어요.");
	});

	test("관리자 표를 읽다 오류가 나도 관리자가 아닌 것으로 본다", async () => {
		await open({ tables: { admins: { data: null, error: new Error("권한 없음") } } });
		expect($("manager").hidden).toBe(true);
		expect($("adminNotice").hidden).toBe(false);
	});

	test("관리자면 메뉴·숨긴 가게·알림을 불러온다", async () => {
		const calls = await open();
		expect($("manager").hidden).toBe(false);
		expect($("whoami").textContent).toBe("admin@example.com으로 로그인했어요");
		expect(rowNames()).toEqual(["김치찌개", "케이크"]);
		expect($("menuCount").textContent).toBe("(2개)");
		const cells = [...$("menuRows").querySelector("tr").children].map((cell) => cell.textContent);
		expect(cells.slice(0, 5)).toEqual(["김치찌개", "식사", "한식", "김치찌개, 찌개", "부대찌개"]);
		expect(calls.find((call) => call.table === "menus").ops).toEqual([
			["select", "id, name, kinds, cuisine, search_terms, exclude_terms"],
			["order", "kinds"],
			["order", "cuisine"],
			["order", "name"],
		]);
		expect($("hiddenCount").textContent).toBe("(0곳)");
		expect($("hiddenEmpty").hidden).toBe(false);
		expect($("reportEmpty").hidden).toBe(false);
	});

	test("메뉴 목록을 못 불러오면 표 안에 오류를 적고 개수를 비운다", async () => {
		await open({ tables: { menus: { data: null, error: { message: "시간 초과" } } } });
		expect($("menuCount").textContent).toBe("");
		const cell = $("menuRows").querySelector("td");
		expect(cell.textContent).toBe("메뉴를 불러오지 못했어요: 시간 초과");
		expect(cell.colSpan).toBe(6);
	});
});

describe("로그인", () => {
	test("로그인하면 관리자 화면을 연다", async () => {
		const signIn = [];
		await open({
			session: null,
			auth: {
				signInWithPassword: async (credentials) => {
					signIn.push(credentials);
					return { data: { user }, error: null };
				},
			},
		});
		const form = $("loginForm");
		form.elements.namedItem("email").value = "admin@example.com";
		form.elements.namedItem("password").value = "secret";
		await submit(form);
		expect(signIn).toEqual([{ email: "admin@example.com", password: "secret" }]);
		expect($("loginMessage").textContent).toBe("");
		expect($("manager").hidden).toBe(false);
	});

	test("로그인이 실패하면 오류를 보여 준다", async () => {
		await open({ session: null, auth: { signInWithPassword: async () => ({ data: {}, error: { message: "Invalid" } }) } });
		await submit($("loginForm"));
		expect($("loginMessage").textContent).toBe("이메일이나 비밀번호가 맞지 않아요.");
		expect($("loginMessage").classList.contains("error")).toBe(true);
		expect($("manager").hidden).toBe(true);
	});

	test("로그아웃하면 관리 화면을 숨기고 폼·가게 결과·알림을 비운다", async () => {
		let signedOut = 0;
		await open({
			auth: { signOut: async () => { signedOut += 1; } },
			tables: { places: { data: [{ osm_id: 9, name: "가게", address: null }], error: null } },
			rpc: { nearby_places: { data: [], error: null } },
		});
		$("placeSearch").elements.namedItem("q").value = "가게";
		await submit($("placeSearch"));
		buttonIn($("menuRows"), "수정").click();
		$("logout").click();
		await settle();
		expect(signedOut).toBe(1);
		expect($("manager").hidden).toBe(true);
		expect($("loginForm").hidden).toBe(false);
		expect($("placeResults").children).toHaveLength(0);
		expect($("placeSearch").elements.namedItem("q").value).toBe("");
		expect($("formTitle").textContent).toBe("메뉴 추가");
		expect($("menuForm").elements.namedItem("name").value).toBe("");
		expect($("reportList").children).toHaveLength(0);
	});
});

describe("메뉴 목록 찾기", () => {
	test("이름이나 검색어에 든 말로 거르고 '보이는 수/전체 수'를 적는다", async () => {
		await open();
		const search = $("menuSearch");
		search.value = " 찌개 ";
		search.dispatchEvent(new Event("input"));
		expect(rowNames()).toEqual(["김치찌개"]);
		expect($("menuCount").textContent).toBe("(1/2개)");
		search.value = "케이";
		search.dispatchEvent(new Event("input"));
		expect(rowNames()).toEqual(["케이크"]);
	});

	test("대소문자를 가리지 않는다", async () => {
		await open({ tables: { menus: { data: [{ ...cake, name: "Cake", search_terms: ["Cake"] }], error: null } } });
		$("menuSearch").value = "cAKE";
		$("menuSearch").dispatchEvent(new Event("input"));
		expect(rowNames()).toEqual(["Cake"]);
	});

	test("맞는 메뉴가 없으면 빈 안내 한 줄을 둔다", async () => {
		await open();
		$("menuSearch").value = "없는말";
		$("menuSearch").dispatchEvent(new Event("input"));
		const cell = $("menuRows").querySelector("td");
		expect(cell.textContent).toBe("찾는 메뉴가 없어요.");
		expect(cell.className).toBe("empty");
		expect($("menuCount").textContent).toBe("(0/2개)");
	});
});

describe("메뉴 저장", () => {
	test("이름이 없으면 보내지 않는다", async () => {
		const calls = await open();
		setMenuForm({ name: "   " });
		await submit($("menuForm"));
		expect($("formMessage").textContent).toBe("메뉴 이름을 적어 주세요.");
		expect($("formMessage").classList.contains("error")).toBe(true);
		expect(calls.some((call) => call.table === "menus" && op(call, "insert"))).toBe(false);
	});

	test("종류를 하나도 고르지 않으면 보내지 않는다", async () => {
		const calls = await open();
		setMenuForm({ name: "라면", kinds: [] });
		await submit($("menuForm"));
		expect($("formMessage").textContent).toBe("종류를 하나 이상 골라 주세요.");
		expect(calls.some((call) => call.table === "menus" && op(call, "insert"))).toBe(false);
	});

	test("새 메뉴는 공백을 다듬고 쉼표 목록을 나눠 넣은 뒤 목록을 다시 불러온다", async () => {
		const calls = await open();
		setMenuForm({ name: " 라면 ", kinds: ["식사", "술"], cuisine: "일식", terms: "라면, 라멘 ,, ", excludes: "" });
		await submit($("menuForm"));
		expect(op(calls.find((call) => call.table === "menus" && op(call, "insert")), "insert")[1]).toEqual({
			name: "라면",
			kinds: ["식사", "술"],
			cuisine: "일식",
			search_terms: ["라면", "라멘"],
			exclude_terms: [],
		});
		expect($("formMessage").textContent).toBe("추가했어요: 라면");
		expect($("formMessage").classList.contains("error")).toBe(false);
		expect($("menuForm").elements.namedItem("name").value).toBe("");
		expect(calls.filter((call) => call.table === "menus" && op(call, "select"))).toHaveLength(2);
		expect($("saveBtn").disabled).toBe(false);
	});

	test("이미 있는 이름(23505)이면 그렇게 알린다", async () => {
		await open({ tables: { menus: (query) => (op(query, "select") ? { data: [], error: null } : { error: { code: "23505", message: "dup" } }) } });
		setMenuForm({ name: "김치찌개" });
		await submit($("menuForm"));
		expect($("formMessage").textContent).toBe("이미 있는 메뉴 이름이에요.");
		expect($("formMessage").classList.contains("error")).toBe(true);
		// 실패하면 적은 글을 지우지 않아요.
		expect($("menuForm").elements.namedItem("name").value).toBe("김치찌개");
	});

	test("그 밖의 오류는 오류 글을 붙여 알린다", async () => {
		await open({ tables: { menus: (query) => (op(query, "select") ? { data: [], error: null } : { error: { code: "42501", message: "권한 없음" } }) } });
		setMenuForm({ name: "라면" });
		await submit($("menuForm"));
		expect($("formMessage").textContent).toBe("저장하지 못했어요: 권한 없음");
		expect($("saveBtn").disabled).toBe(false);
	});

	test("'수정'을 누르면 폼에 그 메뉴를 채우고, 저장하면 그 id 로 고친다", async () => {
		const calls = await open({ rpc: { nearby_places: { data: [], error: null } } });
		buttonIn($("menuRows"), "수정").click();
		const form = $("menuForm");
		expect(form.elements.namedItem("name").value).toBe("김치찌개");
		expect([...form.querySelectorAll("input[name=kinds]")].filter((box) => box.checked).map((box) => box.value)).toEqual(["식사"]);
		expect(form.elements.namedItem("search_terms").value).toBe("김치찌개, 찌개");
		expect(form.elements.namedItem("exclude_terms").value).toBe("부대찌개");
		expect($("formTitle").textContent).toBe("메뉴 수정: 김치찌개");
		expect($("saveBtn").textContent).toBe("저장");
		expect($("cancelEdit").hidden).toBe(false);
		await settle();
		form.elements.namedItem("name").value = "김치찌개백반";
		await submit(form);
		const update = calls.find((call) => call.table === "menus" && op(call, "update"));
		expect(op(update, "update")[1].name).toBe("김치찌개백반");
		expect(op(update, "eq")).toEqual(["eq", "id", 1]);
		expect($("formMessage").textContent).toBe("수정했어요: 김치찌개백반");
		expect($("formTitle").textContent).toBe("메뉴 추가");
	});

	test("수정 중 '취소'를 누르면 폼을 비우고 추가 모드로 돌아간다", async () => {
		await open({ rpc: { nearby_places: { data: [], error: null } } });
		buttonIn($("menuRows"), "수정").click();
		await settle();
		$("cancelEdit").click();
		expect($("formTitle").textContent).toBe("메뉴 추가");
		expect($("saveBtn").textContent).toBe("추가");
		expect($("cancelEdit").hidden).toBe(true);
		expect($("menuForm").elements.namedItem("name").value).toBe("");
		expect($("termsPreview").textContent).toBe("");
		expect($("formMessage").textContent).toBe("");
	});
});

describe("메뉴 삭제", () => {
	test("확인 창에서 취소하면 지우지 않는다", async () => {
		const asked = [];
		globalThis.confirm = (text) => {
			asked.push(text);
			return false;
		};
		const calls = await open();
		buttonIn($("menuRows"), "삭제").click();
		await settle();
		expect(asked).toEqual(["'김치찌개' 메뉴를 삭제할까요?"]);
		expect(calls.some((call) => call.table === "menus" && op(call, "delete"))).toBe(false);
	});

	test("지우지 못하면 오류를 알린다", async () => {
		globalThis.confirm = () => true;
		await open({ tables: { menus: (query) => (op(query, "select") ? { data: [kimchi], error: null } : { error: { message: "권한 없음" } }) } });
		buttonIn($("menuRows"), "삭제").click();
		await settle();
		expect($("formMessage").textContent).toBe("삭제하지 못했어요: 권한 없음");
		expect($("formMessage").classList.contains("error")).toBe(true);
	});

	test("고치던 메뉴를 지우면 폼을 비우고, 목록을 다시 불러온다", async () => {
		globalThis.confirm = () => true;
		const calls = await open({ rpc: { nearby_places: { data: [], error: null } } });
		buttonIn($("menuRows"), "수정").click();
		await settle();
		buttonIn($("menuRows"), "삭제").click();
		await settle();
		expect(op(calls.find((call) => call.table === "menus" && op(call, "delete")), "eq")).toEqual(["eq", "id", 1]);
		expect($("formMessage").textContent).toBe("삭제했어요: 김치찌개");
		expect($("formTitle").textContent).toBe("메뉴 추가");
		expect($("menuForm").elements.namedItem("name").value).toBe("");
	});

	test("다른 메뉴를 고치는 중이면 폼은 그대로 둔다", async () => {
		globalThis.confirm = () => true;
		await open({ rpc: { nearby_places: { data: [], error: null } } });
		buttonIn($("menuRows").children[1], "수정").click();
		await settle();
		buttonIn($("menuRows").children[0], "삭제").click();
		await settle();
		expect($("formTitle").textContent).toBe("메뉴 수정: 케이크");
	});
});

describe("검색어 미리보기", () => {
	function place(name, matched = true) {
		return { name, matched, amenity: "restaurant", shop: null, category: null };
	}

	async function preview(data, error = null, menu = {}) {
		const calls = await open({ rpc: { nearby_places: { data, error } } });
		setMenuForm({ name: "김치찌개", terms: "김치찌개, 찌개", excludes: "부대찌개", ...menu });
		// '수정'과 같은 길로 미리보기를 바로 불러요.
		buttonIn($("menuRows"), "수정").click();
		await settle();
		return calls;
	}

	test("강남역 2km 안을 메뉴의 검색어·가게 종류로 찾는다", async () => {
		const calls = await preview([]);
		expect(calls.find((call) => call.rpc === "nearby_places").params).toEqual({
			p_lat: 37.4979,
			p_lng: 127.0276,
			p_radius: 2000,
			p_terms: ["김치찌개", "찌개"],
			p_amenities: ["restaurant", "fast_food", "food_court"],
			p_shops: [],
			p_similar_amenities: [],
			p_similar_cuisine: null,
		});
	});

	test("잡히는 가게가 없으면 그렇게 적는다", async () => {
		await preview([place("국밥집")]);
		expect($("termsPreview").textContent).toBe("강남역 2km 안에 이 검색어로 잡히는 가게가 없어요.");
	});

	test("가까운 80곳이 모두 제외어에 걸리면 그렇게 적는다", async () => {
		await preview(Array.from({ length: 80 }, (_, index) => place("부대찌개 " + index)));
		expect($("termsPreview").textContent).toBe("강남역 2km 안 가까운 80곳이 모두 제외어에 걸렸어요.");
	});

	test("잡힌 가게 수와 앞의 세 곳, 제외어로 빠진 수를 적는다", async () => {
		await preview([place("김치찌개 A"), place("찌개 B"), place("부대찌개 C"), place("찌개 D"), place("김치찌개 E"), place("국수", false)]);
		expect($("termsPreview").textContent).toBe("강남역 2km 안 4곳: 김치찌개 A, 찌개 B, 찌개 D 등 (제외어로 1곳 빠짐)");
	});

	test("세 곳 이하면 '등'을 붙이지 않고, 빠진 곳이 없으면 괄호도 없다", async () => {
		await preview([place("김치찌개 A"), place("찌개 B")]);
		expect($("termsPreview").textContent).toBe("강남역 2km 안 2곳: 김치찌개 A, 찌개 B");
	});

	test("80곳을 다 받았으면 '곳 넘게'로 적는다", async () => {
		await preview(Array.from({ length: 80 }, (_, index) => place("찌개 " + index)));
		expect($("termsPreview").textContent).toStartWith("강남역 2km 안 80곳 넘게: 찌개 0, 찌개 1, 찌개 2 등");
	});

	test("오류면 오류 글을 붙여 적는다", async () => {
		await preview(null, { message: "시간 초과" });
		expect($("termsPreview").textContent).toBe("미리보기를 하지 못했어요: 시간 초과");
	});

	test("이름이나 종류가 없으면 찾지 않고 비운다", async () => {
		jest.useFakeTimers();
		const calls = useFakeSupabase({ session: { user }, tables: fakeTables(), rpc: { nearby_places: { data: [], error: null } } });
		await loadPage("admin.html");
		const loading = freshImport("js/admin.js");
		for (let i = 0; i < 20; i += 1) {
			await Promise.resolve();
		}
		await loading;
		setMenuForm({ name: "", kinds: ["식사"] });
		$("menuForm").elements.namedItem("name").dispatchEvent(new Event("input", { bubbles: true }));
		jest.advanceTimersByTime(400);
		setMenuForm({ name: "라면", kinds: [] });
		$("menuForm").elements.namedItem("name").dispatchEvent(new Event("input", { bubbles: true }));
		jest.advanceTimersByTime(400);
		expect($("termsPreview").textContent).toBe("");
		expect(calls.some((call) => call.rpc === "nearby_places")).toBe(false);
	});

	test("글을 고치면 400ms 동안 더 고치지 않을 때 한 번만 찾는다", async () => {
		jest.useFakeTimers();
		const calls = useFakeSupabase({ session: { user }, tables: fakeTables(), rpc: { nearby_places: { data: [], error: null } } });
		await loadPage("admin.html");
		await freshImport("js/admin.js");
		const input = $("menuForm").elements.namedItem("name");
		setMenuForm({ name: "라" });
		input.dispatchEvent(new Event("input", { bubbles: true }));
		jest.advanceTimersByTime(300);
		setMenuForm({ name: "라면" });
		input.dispatchEvent(new Event("input", { bubbles: true }));
		jest.advanceTimersByTime(399);
		expect(calls.some((call) => call.rpc === "nearby_places")).toBe(false);
		jest.advanceTimersByTime(1);
		expect(calls.filter((call) => call.rpc === "nearby_places").map((call) => call.params.p_terms)).toEqual([["라면"]]);
		expect($("termsPreview").textContent).toBe("강남역 2km 안에서 찾는 중…");
	});

	test("나라·관계없는 칸을 바꿔서는 찾지 않는다", async () => {
		jest.useFakeTimers();
		const calls = useFakeSupabase({ session: { user }, tables: fakeTables(), rpc: { nearby_places: { data: [], error: null } } });
		await loadPage("admin.html");
		await freshImport("js/admin.js");
		setMenuForm({ name: "라면" });
		$("menuForm").elements.namedItem("cuisine").dispatchEvent(new Event("input", { bubbles: true }));
		jest.advanceTimersByTime(1000);
		expect(calls.some((call) => call.rpc === "nearby_places")).toBe(false);
	});

	test("늦게 온 앞 결과는 버리고 마지막 결과만 적는다", async () => {
		const replies = [];
		await open({
			rpc: {
				nearby_places: () => new Promise((resolve) => replies.push(resolve)),
			},
		});
		buttonIn($("menuRows").children[0], "수정").click();
		buttonIn($("menuRows").children[1], "수정").click();
		await settle();
		replies[1]({ data: [place("케이크 하우스")], error: null });
		await settle();
		replies[0]({ data: [], error: { message: "늦은 오류" } });
		await settle();
		expect($("termsPreview").textContent).toBe("강남역 2km 안 1곳: 케이크 하우스");
	});

	test("취소한 뒤 온 결과는 적지 않는다", async () => {
		let reply;
		await open({ rpc: { nearby_places: () => new Promise((resolve) => { reply = resolve; }) } });
		buttonIn($("menuRows"), "수정").click();
		await settle();
		$("cancelEdit").click();
		reply({ data: [place("김치찌개 A")], error: null });
		await settle();
		expect($("termsPreview").textContent).toBe("");
	});
});

describe("가게 숨기기", () => {
	const shops = [
		{ osm_id: 3, name: "하나식당", address: "서울 강남구" },
		{ osm_id: 1, name: "가나분식", address: null },
		{ osm_id: 2, name: "다라국밥", address: "서울 중구" },
	];

	async function search(query, places = shops, extra = {}) {
		const calls = await open({ tables: { places: { data: places.map((place) => ({ ...place })), error: null }, ...extra } });
		$("placeSearch").elements.namedItem("q").value = query;
		await submit($("placeSearch"));
		return calls;
	}

	test("빈 칸이면 찾지 않는다", async () => {
		const calls = await search("   ");
		expect(calls.some((call) => call.table === "places")).toBe(false);
		expect($("hideMessage").textContent).toBe("");
	});

	test("% _ \\ 를 글자 그대로 찾게 바꾸고, 받은 결과를 가나다순으로 보여 준다", async () => {
		const calls = await search(" 50%_할인\\ ");
		expect(calls.find((call) => call.table === "places").ops).toEqual([
			["select", "osm_id, name, address"],
			["ilike", "name", "%50\\%\\_할인\\\\%"],
			["limit", 30],
		]);
		const names = [...$("placeResults").querySelectorAll(".place-name")].map((line) => line.textContent);
		expect(names).toEqual(["가나분식", "다라국밥", "하나식당"]);
		expect($("placeResults").querySelector(".place-address").textContent).toBe("주소 정보 없음");
		expect($("hideMessage").textContent).toBe("");
	});

	test("없으면 그렇게 알린다", async () => {
		await search("없는가게", []);
		expect($("hideMessage").textContent).toBe("그런 이름의 가게가 없어요.");
	});

	test("30곳을 다 받으면 이름을 더 길게 적으라고 한다", async () => {
		await search("김밥", Array.from({ length: 30 }, (_, index) => ({ osm_id: index, name: "김밥 " + index, address: null })));
		expect($("hideMessage").textContent).toBe("30곳까지만 보여 줘요. 이름을 더 길게 적으면 좁혀져요.");
	});

	test("찾다 오류가 나면 알린다", async () => {
		await open({ tables: { places: { data: null, error: { message: "시간 초과" } } } });
		$("placeSearch").elements.namedItem("q").value = "김밥";
		await submit($("placeSearch"));
		expect($("hideMessage").textContent).toBe("가게를 찾지 못했어요: 시간 초과");
		expect($("hideMessage").classList.contains("error")).toBe(true);
	});

	test("이미 숨긴 가게에는 단추 대신 '숨김'을 둔다", async () => {
		await search("식당", shops, { hidden_places: (query) => (op(query, "select") ? { data: [{ osm_id: 3, name: "하나식당", address: "서울 강남구" }], error: null } : { error: null }) });
		const items = [...$("placeResults").children];
		expect(items.map((item) => item.lastElementChild.textContent)).toEqual(["숨기기", "숨기기", "숨김"]);
		expect($("hiddenCount").textContent).toBe("(1곳)");
		expect($("hiddenEmpty").hidden).toBe(true);
	});

	test("'숨기기'를 누르면 넣고 숨긴 목록을 다시 불러온다", async () => {
		let hidden = [];
		const calls = await search("식당", shops, {
			hidden_places: (query) => {
				const insert = op(query, "insert");
				if (insert) {
					hidden = [...hidden, insert[1]];
					return { error: null };
				}
				return { data: hidden, error: null };
			},
		});
		buttonIn($("placeResults").children[0], "숨기기").click();
		await settle();
		expect(op(calls.find((call) => call.table === "hidden_places" && op(call, "insert")), "insert")[1]).toEqual({ osm_id: 1, name: "가나분식", address: null });
		expect($("hideMessage").textContent).toBe("숨겼어요: 가나분식");
		expect($("placeResults").children[0].lastElementChild.textContent).toBe("숨김");
		expect([...$("hiddenList").querySelectorAll(".place-name")].map((line) => line.textContent)).toEqual(["가나분식"]);
	});

	test("숨기지 못하면 알린다", async () => {
		await search("식당", shops, { hidden_places: (query) => (op(query, "select") ? { data: [], error: null } : { error: { message: "권한 없음" } }) });
		buttonIn($("placeResults").children[0], "숨기기").click();
		await settle();
		expect($("hideMessage").textContent).toBe("숨기지 못했어요: 권한 없음");
		expect($("hideMessage").classList.contains("error")).toBe(true);
	});

	test("'다시 보이기'를 누르면 숨긴 목록에서 빼고, 못 빼면 알린다", async () => {
		let hidden = [{ osm_id: 5, name: "마바집", address: null }];
		let fail = true;
		const calls = await open({
			tables: {
				hidden_places: (query) => {
					if (op(query, "delete")) {
						if (fail) {
							return { error: { message: "권한 없음" } };
						}
						hidden = [];
						return { error: null };
					}
					return { data: hidden, error: null };
				},
			},
		});
		buttonIn($("hiddenList"), "다시 보이기").click();
		await settle();
		expect($("hideMessage").textContent).toBe("다시 보이게 하지 못했어요: 권한 없음");
		fail = false;
		buttonIn($("hiddenList"), "다시 보이기").click();
		await settle();
		expect(op(calls.find((call) => call.table === "hidden_places" && op(call, "delete")), "eq")).toEqual(["eq", "osm_id", 5]);
		expect($("hideMessage").textContent).toBe("다시 보이게 했어요: 마바집");
		expect($("hiddenList").children).toHaveLength(0);
		expect($("hiddenEmpty").hidden).toBe(false);
	});

	test("숨긴 가게를 못 불러오면 알린다", async () => {
		await open({ tables: { hidden_places: { data: null, error: { message: "시간 초과" } } } });
		expect($("hideMessage").textContent).toBe("숨긴 가게를 불러오지 못했어요: 시간 초과");
	});
});

describe("경고 알림", () => {
	// 알림은 최신순으로 와요.
	const reports = [
		{ id: 11, name: "문닫은집", address: null, lat: 37.50001, lng: 127.00001, reason: "no_info", reported_at: "2026-11-03T12:00:00Z" },
		{ id: 12, name: "다른집", address: "서울 중구", lat: 37.6, lng: 127.1, reason: "closed", reported_at: "2026-11-02T12:00:00Z" },
		{ id: 13, name: "문닫은집", address: "서울 강남구", lat: 37.50004, lng: 127.00004, reason: "closed", reported_at: "2026-10-01T12:00:00Z" },
		{ id: 14, name: "문닫은집", address: "다른 주소", lat: 37.50002, lng: 127.00002, reason: "closed", reported_at: "2026-09-01T12:00:00Z" },
		// 좌표가 소수 넷째 자리에서 달라지면 다른 가게로 봐요.
		{ id: 15, name: "문닫은집", address: null, lat: 37.5003, lng: 127.0, reason: "not_found", reported_at: "2026-08-01T12:00:00Z" },
	];

	function reportTable(handlers = {}) {
		return (query) => {
			if (op(query, "select")) {
				return handlers.select?.(query) ?? { data: reports, error: null };
			}
			return handlers.delete?.(query) ?? { error: null };
		};
	}

	const lines = (item) => [...item.querySelectorAll("p")].map((line) => line.textContent);

	test("이름과 좌표(소수 넷째 자리)가 같은 알림을 묶고, 사유를 정해진 순서로 센다", async () => {
		await open({ tables: { closure_reports: reportTable() } });
		const items = [...$("reportList").children];
		expect(items.map(lines)).toEqual([
			["문닫은집", "서울 강남구", "문 닫음 2 · 정보 없음 1 · 최근 11-03"],
			["다른집", "서울 중구", "문 닫음 1 · 최근 11-02"],
			["문닫은집", "주소 정보 없음", "찾을 수 없음 1 · 최근 08-01"],
		]);
		expect($("reportEmpty").hidden).toBe(true);
	});

	test("알림을 못 불러오면 알린다", async () => {
		await open({ tables: { closure_reports: reportTable({ select: () => ({ data: null, error: { message: "시간 초과" } }) }) } });
		expect($("reportMessage").textContent).toBe("알림을 불러오지 못했어요: 시간 초과");
	});

	test("'지우기'는 그 묶음의 알림을 모두 지우고, 못 지우면 알린다", async () => {
		let fail = true;
		const calls = await open({
			tables: {
				closure_reports: reportTable({ delete: () => (fail ? { error: { message: "권한 없음" } } : { error: null }) }),
			},
		});
		buttonIn($("reportList").children[0], "지우기").click();
		await settle();
		expect($("reportMessage").textContent).toBe("알림을 지우지 못했어요: 권한 없음");
		fail = false;
		buttonIn($("reportList").children[0], "지우기").click();
		await settle();
		const removal = calls.filter((call) => call.table === "closure_reports" && op(call, "delete")).at(-1);
		expect(op(removal, "in")).toEqual(["in", "id", [11, 13, 14]]);
		expect($("reportMessage").textContent).toBe("");
		expect($("reportMessage").classList.contains("error")).toBe(false);
	});

	describe("'숨기기'", () => {
		async function hide({ places, hidden = [], hideError = null, deleteError = null }) {
			const calls = await open({
				tables: {
					closure_reports: reportTable({ delete: () => ({ error: deleteError }) }),
					places,
					hidden_places: (query) => (op(query, "select") ? { data: hidden, error: null } : { error: hideError }),
				},
			});
			buttonIn($("reportList").children[0], "숨기기").click();
			await settle();
			return calls;
		}

		test("같은 이름으로 알린 좌표 ±0.0005 안의 가게를 찾아 숨기고 알림을 지운다", async () => {
			const calls = await hide({ places: { data: [{ osm_id: 7, name: "문닫은집", address: "서울 강남구" }, { osm_id: 8, name: "문닫은집", address: null }], error: null } });
			const query = calls.find((call) => call.table === "places");
			expect(query.ops[1]).toEqual(["eq", "name", "문닫은집"]);
			expect(query.ops.slice(2).map(([method, column, value]) => [method, column, Number(value.toFixed(5))])).toEqual([
				["gte", "lat", 37.49951],
				["lte", "lat", 37.50051],
				["gte", "lng", 126.99951],
				["lte", "lng", 127.00051],
			]);
			expect(op(calls.find((call) => call.table === "hidden_places" && op(call, "insert")), "insert")[1]).toEqual([
				{ osm_id: 7, name: "문닫은집", address: "서울 강남구" },
				{ osm_id: 8, name: "문닫은집", address: null },
			]);
			expect(op(calls.find((call) => call.table === "closure_reports" && op(call, "delete")), "in")).toEqual(["in", "id", [11, 13, 14]]);
			expect($("reportMessage").textContent).toBe("");
		});

		test("이미 숨긴 가게만 있으면 넣지 않고 알림만 지운다", async () => {
			const calls = await hide({
				places: { data: [{ osm_id: 7, name: "문닫은집", address: null }], error: null },
				hidden: [{ osm_id: 7, name: "문닫은집", address: null }],
			});
			expect(calls.some((call) => call.table === "hidden_places" && op(call, "insert"))).toBe(false);
			expect(calls.some((call) => call.table === "closure_reports" && op(call, "delete"))).toBe(true);
		});

		test("가게를 찾다 오류가 나면 알리고 아무것도 지우지 않는다", async () => {
			const calls = await hide({ places: { data: null, error: { message: "시간 초과" } } });
			expect($("reportMessage").textContent).toBe("가게를 찾지 못했어요: 시간 초과");
			expect(calls.some((call) => call.table === "closure_reports" && op(call, "delete"))).toBe(false);
		});

		test("가게를 하나도 못 찾으면 알림을 그대로 둔다", async () => {
			const calls = await hide({ places: { data: [], error: null } });
			expect($("reportMessage").textContent).toBe("숨길 가게를 찾지 못했어요: 문닫은집");
			expect($("reportMessage").classList.contains("error")).toBe(true);
			expect(calls.some((call) => call.table === "closure_reports" && op(call, "delete"))).toBe(false);
		});

		test("숨기지 못하면 알림을 지우지 않는다", async () => {
			const calls = await hide({ places: { data: [{ osm_id: 7, name: "문닫은집", address: null }], error: null }, hideError: { message: "권한 없음" } });
			expect($("reportMessage").textContent).toBe("숨기지 못했어요: 권한 없음");
			expect(calls.some((call) => call.table === "closure_reports" && op(call, "delete"))).toBe(false);
		});

		test("숨긴 뒤 알림을 못 지우면 그렇게 알린다", async () => {
			await hide({ places: { data: [{ osm_id: 7, name: "문닫은집", address: null }], error: null }, deleteError: { message: "권한 없음" } });
			expect($("reportMessage").textContent).toBe("알림을 지우지 못했어요: 권한 없음");
			expect($("reportMessage").classList.contains("error")).toBe(true);
		});
	});
});
