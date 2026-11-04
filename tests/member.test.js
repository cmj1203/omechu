import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { failSupabase, useFakeSupabase, useNoSupabase } from "./helpers/fake-supabase.js";
import { freshImport } from "./helpers/dom.js";

// member.js 는 즐겨찾기·제외 메뉴를 한 화면에서 한 번만 불러 두므로, 시험마다 새로 불러와요.
let member;
let warn;

const user = { id: "u1", email: "a@b.c" };
const signedInAs = { session: { user } };
const kimbap = { name: "김밥천국", address: "서울 중구", lat: 37.5, lng: 127 };

beforeEach(async () => {
	useNoSupabase();
	member = await freshImport("js/member.js");
	warn = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	warn.mockRestore();
});

describe("placeId", () => {
	test("이름·위도·경도를 | 로 잇는다", () => {
		expect(member.placeId(kimbap)).toBe("김밥천국|37.5|127");
	});
});

describe("signedIn", () => {
	test("Supabase 가 없으면 null", async () => {
		expect(await member.signedIn()).toBeNull();
	});

	test("세션이 없으면 null", async () => {
		useFakeSupabase();
		expect(await member.signedIn()).toBeNull();
	});

	test("세션이 있으면 클라이언트와 사용자", async () => {
		useFakeSupabase(signedInAs);
		const found = await member.signedIn();
		expect(found.user).toBe(user);
		expect(typeof found.supabase.from).toBe("function");
	});

	test("라이브러리를 못 받거나 세션 확인이 실패하면 null", async () => {
		failSupabase(new Error("cdn"));
		expect(await member.signedIn()).toBeNull();
		useFakeSupabase({ auth: { getSession: async () => {
			throw new Error("auth");
		} } });
		expect(await member.signedIn()).toBeNull();
	});
});

describe("favoriteIds", () => {
	test("로그인하지 않았으면 null", async () => {
		expect(await member.favoriteIds()).toBeNull();
	});

	test("즐겨찾기 줄을 placeId 묶음으로 바꾸고, 한 번만 묻는다", async () => {
		const calls = useFakeSupabase({ ...signedInAs, tables: { favorite_places: { data: [kimbap], error: null } } });
		const first = await member.favoriteIds();
		expect([...first]).toEqual(["김밥천국|37.5|127"]);
		expect(await member.favoriteIds()).toBe(first);
		expect(calls).toEqual([{ table: "favorite_places", ops: [["select", "name, lat, lng"]] }]);
	});

	test("불러오기가 실패하면 경고하고 빈 묶음", async () => {
		useFakeSupabase({ ...signedInAs, tables: { favorite_places: { data: null, error: new Error("x") } } });
		expect([...await member.favoriteIds()]).toEqual([]);
		expect(warn).toHaveBeenCalledTimes(1);
	});
});

describe("setFavorite", () => {
	test("로그인하지 않았으면 signed-out 이고 아무것도 쓰지 않는다", async () => {
		expect(await member.setFavorite(kimbap, true)).toBe("signed-out");
	});

	test("넣으면 insert 하고 불러 둔 묶음에도 더한다", async () => {
		const calls = useFakeSupabase({ ...signedInAs, tables: { favorite_places: (query) => (query.ops[0][0] === "select" ? { data: [], error: null } : { error: null }) } });
		const ids = await member.favoriteIds();
		expect(await member.setFavorite({ name: "A", address: "", lat: 1, lng: 2 }, true)).toBe("saved");
		expect(calls[1].ops).toEqual([["insert", { name: "A", address: null, lat: 1, lng: 2 }]]);
		expect(ids.has("A|1|2")).toBe(true);
	});

	test("빼면 이름·좌표로 delete 하고 묶음에서도 뺀다", async () => {
		const calls = useFakeSupabase({ ...signedInAs, tables: { favorite_places: (query) => (query.ops[0][0] === "select" ? { data: [kimbap], error: null } : { error: null }) } });
		const ids = await member.favoriteIds();
		expect(await member.setFavorite(kimbap, false)).toBe("saved");
		expect(calls[1].ops).toEqual([["delete"], ["eq", "name", "김밥천국"], ["eq", "lat", 37.5], ["eq", "lng", 127]]);
		expect(ids.has("김밥천국|37.5|127")).toBe(false);
	});

	test("이미 넣어 둔 가게(23505)는 넣은 것으로 본다", async () => {
		useFakeSupabase({ ...signedInAs, tables: { favorite_places: (query) => (query.ops[0][0] === "select" ? { data: [], error: null } : { error: { code: "23505" } }) } });
		expect(await member.setFavorite(kimbap, true)).toBe("saved");
		expect((await member.favoriteIds()).has("김밥천국|37.5|127")).toBe(true);
	});

	test("다른 오류는 던진다", async () => {
		const failure = { code: "42501", message: "denied" };
		useFakeSupabase({ ...signedInAs, tables: { favorite_places: { error: failure } } });
		await expect(member.setFavorite(kimbap, true)).rejects.toBe(failure);
	});
});

describe("recordView", () => {
	test("로그인하지 않았으면 아무것도 쓰지 않는다", async () => {
		const calls = useFakeSupabase();
		await member.recordView(kimbap);
		expect(calls).toEqual([]);
	});

	test("본 시각과 함께 upsert 하고 같은 가게는 덮어쓴다", async () => {
		const calls = useFakeSupabase({ ...signedInAs, tables: { recent_places: { error: null } } });
		await member.recordView({ name: "B", lat: 3, lng: 4 });
		const [method, row, options] = calls[0].ops[0];
		expect(method).toBe("upsert");
		expect(row).toMatchObject({ name: "B", address: null, lat: 3, lng: 4 });
		expect(new Date(row.viewed_at).toISOString()).toBe(row.viewed_at);
		expect(options).toEqual({ onConflict: "user_id,name,lat,lng" });
	});

	test("실패하면 경고만 남긴다", async () => {
		useFakeSupabase({ ...signedInAs, tables: { recent_places: { error: new Error("x") } } });
		await expect(member.recordView(kimbap)).resolves.toBeUndefined();
		expect(warn).toHaveBeenCalledTimes(1);
	});
});

describe("excludedMenus · setExcluded", () => {
	test("로그인하지 않았으면 null 이고, 바꾸려 하면 signed-out", async () => {
		expect(await member.excludedMenus()).toBeNull();
		expect(await member.setExcluded("김밥", true)).toBe("signed-out");
	});

	test("넣은 순서로 메뉴 이름 묶음을 만들고 한 번만 묻는다", async () => {
		const calls = useFakeSupabase({ ...signedInAs, tables: { excluded_menus: { data: [{ menu: "김밥" }, { menu: "라면" }], error: null } } });
		const names = await member.excludedMenus();
		expect([...names]).toEqual(["김밥", "라면"]);
		expect(await member.excludedMenus()).toBe(names);
		expect(calls).toEqual([{ table: "excluded_menus", ops: [["select", "menu"], ["order", "created_at"]] }]);
	});

	test("불러오기가 실패하면 경고하고 빈 묶음", async () => {
		useFakeSupabase({ ...signedInAs, tables: { excluded_menus: { data: null, error: new Error("x") } } });
		expect([...await member.excludedMenus()]).toEqual([]);
		expect(warn).toHaveBeenCalledTimes(1);
	});

	test("넣기·빼기는 insert·delete 하고 불러 둔 묶음을 맞춘다", async () => {
		const calls = useFakeSupabase({ ...signedInAs, tables: { excluded_menus: (query) => (query.ops[0][0] === "select" ? { data: [{ menu: "김밥" }], error: null } : { error: null }) } });
		const names = await member.excludedMenus();
		expect(await member.setExcluded("라면", true)).toBe("saved");
		expect(await member.setExcluded("김밥", false)).toBe("saved");
		expect(calls[1].ops).toEqual([["insert", { menu: "라면" }]]);
		expect(calls[2].ops).toEqual([["delete"], ["eq", "menu", "김밥"]]);
		expect([...names]).toEqual(["라면"]);
	});

	test("이미 넣은 메뉴(23505)는 넣은 것으로 보고, 다른 오류는 던진다", async () => {
		let failure = { code: "23505" };
		useFakeSupabase({ ...signedInAs, tables: { excluded_menus: (query) => (query.ops[0][0] === "select" ? { data: [], error: null } : { error: failure }) } });
		expect(await member.setExcluded("김밥", true)).toBe("saved");
		failure = { code: "500", message: "x" };
		await expect(member.setExcluded("김밥", false)).rejects.toBe(failure);
	});
});

describe("listFavorites · listRecent", () => {
	test("즐겨찾기는 넣은 때 최신순으로 읽는다", async () => {
		const rows = [kimbap];
		const calls = useFakeSupabase({ tables: { favorite_places: { data: rows, error: null } } });
		const supabase = await (await import("../js/supabase.js")).getSupabase();
		expect(await member.listFavorites(supabase)).toBe(rows);
		expect(calls[0].ops).toEqual([["select", "name, address, lat, lng"], ["order", "created_at", { ascending: false }]]);
	});

	test("최근 본 가게는 본 때 최신순으로 30곳까지 읽는다", async () => {
		const calls = useFakeSupabase({ tables: { recent_places: { data: [], error: null } } });
		const supabase = await (await import("../js/supabase.js")).getSupabase();
		expect(await member.listRecent(supabase)).toEqual([]);
		expect(calls[0].ops).toEqual([["select", "name, address, lat, lng, viewed_at"], ["order", "viewed_at", { ascending: false }], ["limit", 30]]);
	});

	test("오류는 던진다", async () => {
		const failure = new Error("x");
		useFakeSupabase({ tables: { favorite_places: { data: null, error: failure }, recent_places: { data: null, error: failure } } });
		const supabase = await (await import("../js/supabase.js")).getSupabase();
		await expect(member.listFavorites(supabase)).rejects.toBe(failure);
		await expect(member.listRecent(supabase)).rejects.toBe(failure);
	});
});
