import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from "bun:test";
import { failSupabase, setConfigured, useFakeSupabase, useNoSupabase } from "./helpers/fake-supabase.js";
import { freshImport } from "./helpers/dom.js";
import { loadMenus } from "../js/menus.js";

const dbMenus = [{ name: "김치찌개", kinds: ["식사"], cuisine: "한식" }];
const fileMenus = [{ name: "기본 메뉴", kinds: ["식사"], cuisine: "한식" }];

let fetchSpy;
let warn;

beforeEach(() => {
	useNoSupabase();
	fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(fileMenus), { status: 200 }));
	warn = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	fetchSpy.mockRestore();
	warn.mockRestore();
	jest.useRealTimers();
	setConfigured(true);
});

describe("loadMenus", () => {
	test("DB 에 메뉴가 있으면 그 메뉴를 쓰고 기본 목록은 받지 않는다", async () => {
		const calls = useFakeSupabase({ tables: { menus: { data: dbMenus, error: null } } });
		expect(await loadMenus()).toEqual({ menus: dbMenus, usedFallback: false });
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(calls[0].table).toBe("menus");
		expect(calls[0].ops[0]).toEqual(["select", "name, kinds, cuisine, staple, search_terms, exclude_terms, broad_terms, categories, broad_categories"]);
		expect(calls[0].ops[1][0]).toBe("abortSignal");
		expect(calls[0].ops[1][1]).toBeInstanceOf(AbortSignal);
	});

	test("DB 가 비어 있으면 기본 목록을 쓰고 usedFallback 은 true 다", async () => {
		useFakeSupabase({ tables: { menus: { data: [], error: null } } });
		expect(await loadMenus()).toEqual({ menus: fileMenus, usedFallback: true });
		expect(fetchSpy).toHaveBeenCalledWith("data/menus.json");
		expect(warn).not.toHaveBeenCalled();
	});

	test("DB 오류는 경고만 남기고 기본 목록으로 넘어간다", async () => {
		useFakeSupabase({ tables: { menus: { data: null, error: new Error("db down") } } });
		expect(await loadMenus()).toEqual({ menus: fileMenus, usedFallback: true });
		expect(warn).toHaveBeenCalledTimes(1);
	});

	test("Supabase 라이브러리를 못 받아도 기본 목록으로 넘어간다", async () => {
		failSupabase(new Error("cdn"));
		expect(await loadMenus()).toEqual({ menus: fileMenus, usedFallback: true });
	});

	test("클라이언트가 없으면(설정 없음) 기본 목록을 쓴다", async () => {
		expect(await loadMenus()).toEqual({ menus: fileMenus, usedFallback: true });
		expect(warn).not.toHaveBeenCalled();
	});

	test("Supabase 를 설정하지 않았으면 기본 목록을 쓰고 usedFallback 은 false 다", async () => {
		setConfigured(false);
		const fresh = await freshImport("js/menus.js");
		expect(await fresh.loadMenus()).toEqual({ menus: fileMenus, usedFallback: false });
	});

	test("DB 가 10초 안에 답하지 않으면 기본 목록으로 넘어간다", async () => {
		jest.useFakeTimers();
		useFakeSupabase({ tables: { menus: () => new Promise(() => {}) } });
		const loading = loadMenus();
		await Promise.resolve();
		jest.advanceTimersByTime(9999);
		await Promise.resolve();
		expect(fetchSpy).not.toHaveBeenCalled();
		jest.advanceTimersByTime(1);
		expect(await loading).toEqual({ menus: fileMenus, usedFallback: true });
		expect(String(warn.mock.calls[0][1].message)).toBe("메뉴 DB 응답이 10초 안에 없어요.");
	});

	test("기본 목록도 못 받으면 상태 번호를 넣어 오류를 던진다", async () => {
		fetchSpy.mockImplementation(async () => new Response("", { status: 404 }));
		await expect(loadMenus()).rejects.toThrow("기본 메뉴 목록을 불러오지 못했어요 (404)");
	});
});
