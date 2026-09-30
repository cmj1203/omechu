import { getSupabase, SUPABASE_CONFIGURED } from "./supabase.js";

export async function loadMenus() {
	try {
		const supabase = await getSupabase();
		if (supabase) {
			const { data, error } = await supabase
				.from("menus")
				.select("name, kind, cuisine, party, times, search_terms")
				.abortSignal(AbortSignal.timeout(5000));
			if (error) {
				throw error;
			}
			if (data.length > 0) {
				return { menus: data, usedFallback: false };
			}
		}
	} catch (error) {
		console.warn("메뉴 DB를 불러오지 못해서 기본 메뉴 목록을 써요.", error);
	}
	const response = await fetch("data/menus.json");
	if (!response.ok) {
		throw new Error("기본 메뉴 목록을 불러오지 못했어요 (" + response.status + ")");
	}
	return { menus: await response.json(), usedFallback: SUPABASE_CONFIGURED };
}
