import { loadPage, freshImport, settle } from "./helpers/dom.js";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { failSupabase, setConfigured, useFakeSupabase } from "./helpers/fake-supabase.js";

// account.js 는 불러올 때 바로 도는 화면 모듈이라, 시험마다 account.html 을 넣고 새로 불러와요.
// 기본으로 뺄 메뉴(member.js excludedMenus)는 한 프로세스에서 처음 부른 결과를 계속 써요.
// 그래서 로그인한 시험의 excluded_menus 는 늘 빈 목록으로 답하고, 넣은 메뉴는 그 시험 안에서 다시 빼요.
const user = { id: "u1", email: "me@example.com" };
const menus = [
	{ name: "김치찌개", kinds: ["식사"], cuisine: "한식" },
	{ name: "가지볶음", kinds: ["식사"], cuisine: "중식" },
	{ name: "냉면", kinds: ["식사"], cuisine: "한식" },
];
const favorite = { name: "종로 김치찌개", address: "서울 종로구", lat: 37.57, lng: 126.98 };
const recentPlace = { name: "냉면집, 본점", address: null, lat: 37.5, lng: 127, viewed_at: "2026-11-04T03:00:00Z" };

const $ = (id) => document.getElementById(id);
let originalConfirm;
let originalAlert;
let warn;

beforeEach(() => {
	originalConfirm = globalThis.confirm;
	originalAlert = globalThis.alert;
	warn = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	globalThis.confirm = originalConfirm;
	globalThis.alert = originalAlert;
	warn.mockRestore();
});

// 표 답을 고를 수 있게 기본 가짜를 둬요. tables 로 표 하나씩 바꿔요.
function fakeTables(overrides = {}) {
	return {
		admins: { data: null, error: null },
		favorite_places: (query) => (query.ops[0][0] === "select" ? { data: [], error: null } : { error: null }),
		recent_places: { data: [], error: null },
		excluded_menus: (query) => (query.ops[0][0] === "select" ? { data: [], error: null } : { error: null }),
		menus: { data: menus, error: null },
		...overrides,
	};
}

async function open({ search = "", session = null, tables = {}, rpc = {}, auth = {} } = {}) {
	const calls = useFakeSupabase({ session, auth, rpc, tables: fakeTables(tables) });
	await loadPage("account.html", search);
	await freshImport("js/account.js");
	await settle();
	return calls;
}

function submit(form, values) {
	for (const [name, value] of Object.entries(values)) {
		form.elements.namedItem(name).value = value;
	}
	// requestSubmit 은 minlength·required 검사에 걸리면 보내지 않아서, 화면 코드의 검사를 보려고 submit 이벤트를 바로 보내요.
	form.dispatchEvent(new Event("submit", { cancelable: true }));
	return settle();
}

describe("처음 열 때", () => {
	test("Supabase 설정이 없으면 안내만 보여 준다", async () => {
		setConfigured(false);
		try {
			useFakeSupabase();
			await loadPage("account.html");
			await freshImport("js/account.js");
		} finally {
			setConfigured(true);
		}
		expect($("accountNotice").hidden).toBe(false);
		expect($("accountNotice").textContent).toBe("아직 Supabase가 연결되지 않았어요.");
		expect($("authBox").hidden).toBe(true);
	});

	test("Supabase 에 연결하지 못하면 오류 글을 붙여 안내한다", async () => {
		failSupabase(new Error("CDN 막힘"));
		await loadPage("account.html");
		await freshImport("js/account.js");
		expect($("accountNotice").textContent).toBe("Supabase에 연결하지 못했어요: CDN 막힘");
		expect($("authBox").hidden).toBe(true);
	});

	test("로그인하지 않았으면 로그인 칸을 보여 준다", async () => {
		await open();
		expect($("authBox").hidden).toBe(false);
		expect($("loginForm").hidden).toBe(false);
		expect($("signupForm").hidden).toBe(true);
		expect($("loginTab").getAttribute("aria-selected")).toBe("true");
		expect($("memberBox").hidden).toBe(true);
	});

	test("?tab=signup 이면 회원가입 칸을 먼저 보여 준다", async () => {
		await open({ search: "?tab=signup" });
		expect($("loginForm").hidden).toBe(true);
		expect($("signupForm").hidden).toBe(false);
		expect($("signupTab").getAttribute("aria-selected")).toBe("true");
		expect($("loginTab").getAttribute("aria-selected")).toBe("false");
	});

	test("탭을 누르면 로그인·회원가입 칸이 바뀐다", async () => {
		await open();
		$("signupTab").click();
		expect($("signupForm").hidden).toBe(false);
		$("loginTab").click();
		expect($("loginForm").hidden).toBe(false);
		expect($("signupForm").hidden).toBe(true);
	});
});

describe("내 계정", () => {
	test("로그인했으면 이메일, 즐겨찾기·최근 본 가게, 뺄 메뉴 고르기 칸을 보여 준다", async () => {
		const calls = await open({
			session: { user },
			tables: {
				favorite_places: (query) => (query.ops.some(([name, columns]) => name === "select" && columns.includes("address"))
					? { data: [favorite], error: null }
					: { data: [], error: null }),
				recent_places: { data: [recentPlace], error: null },
			},
		});
		expect($("authBox").hidden).toBe(true);
		expect($("memberBox").hidden).toBe(false);
		expect($("whoami").textContent).toBe("me@example.com");
		expect($("adminLink").hidden).toBe(true);
		expect($("favoriteCount").textContent).toBe("(1곳)");
		expect($("favoriteEmpty").hidden).toBe(true);
		const favoriteLink = $("favoriteList").querySelector("a");
		expect(favoriteLink.textContent).toBe("종로 김치찌개 ↗");
		expect(favoriteLink.href).toBe("https://map.kakao.com/link/map/" + encodeURIComponent("종로 김치찌개") + ",37.57,126.98");
		expect($("favoriteList").querySelector(".place-address").textContent).toBe("서울 종로구");
		// 이름의 쉼표는 카카오 지도 주소를 깨뜨려서 공백으로 바꿔요. 주소가 없으면 본 날짜만 적어요.
		expect($("recentList").querySelector("a").href).toBe("https://map.kakao.com/link/map/" + encodeURIComponent("냉면집  본점") + ",37.5,127");
		expect($("recentList").querySelector(".place-address").textContent).toBe("11월 4일 봄");
		expect($("recentEmpty").hidden).toBe(true);
		// 메뉴는 가나다순, 이미 뺀 메뉴는 없어요.
		expect([...$("excludeSelect").options].map((option) => option.value)).toEqual(["가지볶음", "김치찌개", "냉면"]);
		expect($("excludedEmpty").hidden).toBe(false);
		expect($("excludedCount").textContent).toBe("");
		expect(calls.find((call) => call.table === "admins").ops).toEqual([["select", "user_id"], ["eq", "user_id", "u1"], ["maybeSingle"]]);
	});

	test("저장한 가게가 없으면 빈 안내를 보여 주고 개수는 비운다", async () => {
		await open({ session: { user } });
		expect($("favoriteCount").textContent).toBe("");
		expect($("favoriteEmpty").hidden).toBe(false);
		expect($("recentEmpty").hidden).toBe(false);
	});

	test("관리자면 관리자 화면 링크를 보여 준다", async () => {
		await open({ session: { user }, tables: { admins: { data: { user_id: "u1" }, error: null } } });
		expect($("adminLink").hidden).toBe(false);
	});

	test("저장한 가게를 못 불러오면 안내한다", async () => {
		await open({ session: { user }, tables: { recent_places: { data: null, error: new Error("시간 초과") } } });
		expect($("accountNotice").hidden).toBe(false);
		expect($("accountNotice").textContent).toBe("저장한 가게를 불러오지 못했어요: 시간 초과");
	});

	test("즐겨찾기 '빼기'를 누르면 빼고 목록을 다시 불러온다", async () => {
		let saved = [favorite];
		const calls = await open({
			session: { user },
			tables: {
				favorite_places: (query) => {
					if (query.ops[0][0] === "delete") {
						saved = [];
						return { error: null };
					}
					return { data: saved, error: null };
				},
			},
		});
		$("favoriteList").querySelector("button").click();
		await settle();
		const removal = calls.find((call) => call.table === "favorite_places" && call.ops[0][0] === "delete");
		expect(removal.ops).toEqual([["delete"], ["eq", "name", "종로 김치찌개"], ["eq", "lat", 37.57], ["eq", "lng", 126.98]]);
		expect($("favoriteList").children).toHaveLength(0);
		expect($("favoriteEmpty").hidden).toBe(false);
	});

	test("즐겨찾기를 못 빼면 안내하고 단추를 다시 켠다", async () => {
		await open({
			session: { user },
			tables: {
				favorite_places: (query) => (query.ops[0][0] === "delete" ? { error: new Error("권한 없음") } : { data: [favorite], error: null }),
			},
		});
		const button = $("favoriteList").querySelector("button");
		button.click();
		expect(button.disabled).toBe(true);
		await settle();
		expect(button.disabled).toBe(false);
		expect($("accountNotice").textContent).toBe("즐겨찾기에서 빼지 못했어요: 권한 없음");
	});
});

describe("기본으로 뺄 메뉴", () => {
	test("넣으면 목록에 보이고 고르기 칸에서 빠지며, '빼기'를 누르면 되돌아간다", async () => {
		const calls = await open({ session: { user } });
		$("excludeSelect").value = "냉면";
		$("excludeForm").requestSubmit();
		await settle();
		expect(calls.find((call) => call.table === "excluded_menus" && call.ops[0][0] === "insert").ops).toEqual([["insert", { menu: "냉면" }]]);
		expect([...$("excludedList").querySelectorAll(".place-name")].map((item) => item.textContent)).toEqual(["냉면"]);
		expect($("excludedCount").textContent).toBe("(1개)");
		expect($("excludedEmpty").hidden).toBe(true);
		expect([...$("excludeSelect").options].map((option) => option.value)).toEqual(["가지볶음", "김치찌개"]);
		expect($("excludeForm").querySelector("button").disabled).toBe(false);

		$("excludedList").querySelector("button").click();
		await settle();
		expect(calls.find((call) => call.table === "excluded_menus" && call.ops[0][0] === "delete").ops).toEqual([["delete"], ["eq", "menu", "냉면"]]);
		expect($("excludedList").children).toHaveLength(0);
		expect([...$("excludeSelect").options].map((option) => option.value)).toEqual(["가지볶음", "김치찌개", "냉면"]);
	});

	test("고른 메뉴가 없으면 아무것도 보내지 않는다", async () => {
		const calls = await open({ session: { user } });
		$("excludeSelect").replaceChildren();
		const before = calls.length;
		$("excludeForm").dispatchEvent(new Event("submit", { cancelable: true }));
		await settle();
		expect(calls.length).toBe(before);
	});

	test("넣지 못하면 안내하고 단추를 다시 켠다", async () => {
		await open({
			session: { user },
			tables: { excluded_menus: (query) => (query.ops[0][0] === "select" ? { data: [], error: null } : { error: { code: "42501", message: "권한 없음" } }) },
		});
		$("excludeSelect").value = "냉면";
		$("excludeForm").requestSubmit();
		await settle();
		expect($("accountNotice").textContent).toBe("기본으로 뺄 메뉴에 넣지 못했어요: 권한 없음");
		expect($("excludeForm").querySelector("button").disabled).toBe(false);
		expect($("excludedList").children).toHaveLength(0);
	});

	test("이미 넣어 둔 메뉴(23505)는 넣은 것으로 본다", async () => {
		await open({
			session: { user },
			tables: { excluded_menus: (query) => (query.ops[0][0] === "select" ? { data: [], error: null } : { error: { code: "23505", message: "중복" } }) },
		});
		$("excludeSelect").value = "냉면";
		$("excludeForm").requestSubmit();
		await settle();
		expect($("accountNotice").hidden).toBe(true);
		expect([...$("excludedList").querySelectorAll(".place-name")].map((item) => item.textContent)).toEqual(["냉면"]);
		// 다음 시험을 위해 같은 Set 에서 다시 빼요.
		$("excludedList").querySelector("button").click();
		await settle();
		expect($("excludedList").children).toHaveLength(0);
	});

	test("빼지 못하면 안내하고 '빼기' 단추를 다시 켠다", async () => {
		let failDelete = false;
		await open({
			session: { user },
			tables: {
				excluded_menus: (query) => {
					if (query.ops[0][0] === "delete" && failDelete) {
						return { error: { code: "42501", message: "권한 없음" } };
					}
					return query.ops[0][0] === "select" ? { data: [], error: null } : { error: null };
				},
			},
		});
		$("excludeSelect").value = "냉면";
		$("excludeForm").requestSubmit();
		await settle();
		failDelete = true;
		const button = $("excludedList").querySelector("button");
		button.click();
		await settle();
		expect(button.disabled).toBe(false);
		expect($("accountNotice").textContent).toBe("기본으로 뺄 메뉴에서 빼지 못했어요: 권한 없음");
		failDelete = false;
		button.click();
		await settle();
		expect($("excludedList").children).toHaveLength(0);
	});

	test("메뉴 목록을 못 불러오면 안내한다", async () => {
		const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));
		try {
			await open({ session: { user }, tables: { menus: { data: null, error: new Error("DB 멈춤") } } });
		} finally {
			fetchSpy.mockRestore();
		}
		expect($("accountNotice").textContent).toBe("기본으로 뺄 메뉴를 불러오지 못했어요: 기본 메뉴 목록을 불러오지 못했어요 (503)");
	});
});

describe("로그인", () => {
	test("이메일 앞뒤 공백을 지우고 로그인한 뒤 내 계정을 연다", async () => {
		const signIn = [];
		await open({
			auth: {
				signInWithPassword: async (credentials) => {
					signIn.push(credentials);
					return { data: { user }, error: null };
				},
			},
		});
		await submit($("loginForm"), { email: "  me@example.com ", password: "secret123" });
		expect(signIn).toEqual([{ email: "me@example.com", password: "secret123" }]);
		expect($("loginMessage").textContent).toBe("");
		expect($("memberBox").hidden).toBe(false);
		expect($("whoami").textContent).toBe("me@example.com");
	});

	test("가입 확인 전이면 메일함을 보라고 한다", async () => {
		await open({ auth: { signInWithPassword: async () => ({ data: {}, error: { code: "email_not_confirmed" } }) } });
		await submit($("loginForm"), { email: "me@example.com", password: "secret123" });
		expect($("loginMessage").textContent).toBe("메일함에서 가입 확인 링크를 먼저 눌러 주세요.");
		expect($("loginMessage").classList.contains("error")).toBe(true);
		expect($("memberBox").hidden).toBe(true);
	});

	test("그 밖의 오류는 이메일·비밀번호가 맞지 않는다고 한다", async () => {
		await open({ auth: { signInWithPassword: async () => ({ data: {}, error: { code: "invalid_credentials" } }) } });
		await submit($("loginForm"), { email: "me@example.com", password: "wrong" });
		expect($("loginMessage").textContent).toBe("이메일이나 비밀번호가 맞지 않아요.");
	});
});

describe("회원가입", () => {
	async function signup(values, signUp) {
		const requests = [];
		await open({
			search: "?tab=signup",
			auth: {
				signUp: async (request) => {
					requests.push(request);
					return signUp(request);
				},
			},
		});
		await submit($("signupForm"), values);
		return requests;
	}

	test("비밀번호가 8자보다 짧으면 보내지 않는다", async () => {
		const requests = await signup({ email: "me@example.com", password: "1234567", confirm: "1234567" }, () => ({}));
		expect(requests).toEqual([]);
		expect($("signupMessage").textContent).toBe("비밀번호는 8자 이상으로 정해 주세요.");
		expect($("signupMessage").classList.contains("error")).toBe(true);
	});

	test("8자면 보낸다", async () => {
		const requests = await signup({ email: "me@example.com", password: "12345678", confirm: "12345678" }, () => ({ data: { session: null }, error: null }));
		expect(requests).toHaveLength(1);
	});

	test("비밀번호 확인이 다르면 보내지 않는다", async () => {
		const requests = await signup({ email: "me@example.com", password: "12345678", confirm: "12345679" }, () => ({}));
		expect(requests).toEqual([]);
		expect($("signupMessage").textContent).toBe("비밀번호 확인이 달라요.");
	});

	test("확인 메일을 쓰면 칸을 비우고 메일을 보냈다고 한다", async () => {
		const requests = await signup({ email: " me@example.com ", password: "12345678", confirm: "12345678" }, () => ({ data: { user, session: null }, error: null }));
		expect(requests).toEqual([{
			email: "me@example.com",
			password: "12345678",
			options: { emailRedirectTo: "https://app.test/account.html" },
		}]);
		expect($("signupMessage").textContent).toBe("me@example.com 으로 확인 메일을 보냈어요. 메일의 링크를 누르면 가입이 끝나요.");
		expect($("signupForm").elements.namedItem("password").value).toBe("");
		expect($("memberBox").hidden).toBe(true);
	});

	test("바로 로그인되는 설정이면 내 계정을 연다", async () => {
		await signup({ email: "me@example.com", password: "12345678", confirm: "12345678" }, () => ({ data: { user, session: { user } }, error: null }));
		expect($("signupMessage").textContent).toBe("");
		expect($("memberBox").hidden).toBe(false);
	});

	const cases = [
		["user_already_exists 코드", { code: "user_already_exists", message: "" }, "이미 가입한 이메일이에요. 로그인해 주세요."],
		["already registered 문구", { message: "User Already Registered" }, "이미 가입한 이메일이에요. 로그인해 주세요."],
		["weak_password", { code: "weak_password", message: "" }, "비밀번호가 너무 쉬워요. 다른 비밀번호로 정해 주세요."],
		["signup_disabled", { code: "signup_disabled", message: "" }, "지금은 회원가입을 받지 않고 있어요."],
		["429", { status: 429, message: "rate limit" }, "잠시 후 다시 시도해 주세요."],
		["그 밖의 오류", { message: "서버 오류" }, "가입하지 못했어요: 서버 오류"],
	];
	for (const [label, error, expected] of cases) {
		test("가입 오류 " + label + " → '" + expected + "'", async () => {
			await signup({ email: "me@example.com", password: "12345678", confirm: "12345678" }, () => ({ data: {}, error }));
			expect($("signupMessage").textContent).toBe(expected);
			expect($("signupMessage").classList.contains("error")).toBe(true);
		});
	}
});

describe("로그아웃·탈퇴", () => {
	test("로그아웃하면 내 계정을 숨기고 로그인 칸을 비워 보여 준다", async () => {
		let signedOut = 0;
		await open({ session: { user }, auth: { signOut: async () => { signedOut += 1; } } });
		$("loginForm").elements.namedItem("email").value = "me@example.com";
		$("logout").click();
		await settle();
		expect(signedOut).toBe(1);
		expect($("memberBox").hidden).toBe(true);
		expect($("authBox").hidden).toBe(false);
		expect($("loginForm").hidden).toBe(false);
		expect($("loginForm").elements.namedItem("email").value).toBe("");
	});

	test("탈퇴를 취소하면 아무것도 하지 않는다", async () => {
		globalThis.confirm = () => false;
		const calls = await open({ session: { user }, rpc: { delete_my_account: { error: null } } });
		$("deleteAccount").click();
		await settle();
		expect(calls.some((call) => call.rpc === "delete_my_account")).toBe(false);
		expect($("memberBox").hidden).toBe(false);
	});

	test("탈퇴가 실패하면 알리고 그대로 둔다", async () => {
		globalThis.confirm = () => true;
		const alerts = [];
		globalThis.alert = (text) => alerts.push(text);
		let signedOut = 0;
		await open({ session: { user }, rpc: { delete_my_account: { error: { message: "권한 없음" } } }, auth: { signOut: async () => { signedOut += 1; } } });
		$("deleteAccount").click();
		await settle();
		expect(alerts).toEqual(["탈퇴하지 못했어요: 권한 없음"]);
		expect(signedOut).toBe(0);
		expect($("memberBox").hidden).toBe(false);
	});

	test("탈퇴하면 로그아웃하고 로그인 칸에 인사를 남긴다", async () => {
		globalThis.confirm = () => true;
		let signedOut = 0;
		await open({ session: { user }, rpc: { delete_my_account: { error: null } }, auth: { signOut: async () => { signedOut += 1; } } });
		$("deleteAccount").click();
		await settle();
		expect(signedOut).toBe(1);
		expect($("memberBox").hidden).toBe(true);
		expect($("authBox").hidden).toBe(false);
		expect($("loginMessage").textContent).toBe("탈퇴했어요. 그동안 고마웠어요.");
	});
});
