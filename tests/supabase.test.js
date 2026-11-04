import { describe, expect, test } from "bun:test";
import "./helpers/fake-supabase.js";
import { freshImport } from "./helpers/dom.js";

// 다른 시험은 supabase.js 를 가짜로 바꿔 쓰지만, 여기서는 물음표 주소로 진짜 모듈을 새로 불러와요.
// 시험 환경에서는 CDN 주소(https://…)를 불러올 수 없어서, 라이브러리를 못 받은 경우를 시험해요.
describe("getSupabase", () => {
	test("공개 키가 들어 있어 SUPABASE_CONFIGURED 가 true 다", async () => {
		const real = await freshImport("js/supabase.js");
		expect(real.SUPABASE_CONFIGURED).toBe(true);
	});

	test("라이브러리를 못 받으면 오류를 던진다", async () => {
		const real = await freshImport("js/supabase.js");
		await expect(real.getSupabase()).rejects.toBeDefined();
	});

	test("받는 중에는 같은 약속을 돌려주고, 실패한 뒤에는 다시 받는다", async () => {
		const real = await freshImport("js/supabase.js");
		const first = real.getSupabase();
		const again = real.getSupabase();
		expect(again).toBe(first);
		await first.catch(() => {});
		const retry = real.getSupabase();
		expect(retry).not.toBe(first);
		await retry.catch(() => {});
	});
});
