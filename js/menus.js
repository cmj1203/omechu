import { getSupabase, SUPABASE_CONFIGURED } from "./supabase.js";

// 라이브러리 로드(8초)와 요청(5초) 사이의 로그인 세션 확인은 제한이 없어서, 사파리가 새로고침 뒤 거기서 멈추면
// '메뉴 불러오는 중…'이 영영 안 끝났어요. 전체에 한 번 더 제한을 두고 넘기면 기본 메뉴 목록으로 넘어가요.
const DB_TIMEOUT_MS = 10000;

export async function loadMenus() {
	let timer;
	try {
		const found = await Promise.race([
			loadFromDatabase(),
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error("메뉴 DB 응답이 " + DB_TIMEOUT_MS / 1000 + "초 안에 없어요.")), DB_TIMEOUT_MS);
			}),
		]);
		if (found) {
			return found;
		}
	} catch (error) {
		console.warn("메뉴 DB를 불러오지 못해서 기본 메뉴 목록을 써요.", error);
	} finally {
		clearTimeout(timer);
	}
	const response = await fetch("data/menus.json");
	if (!response.ok) {
		throw new Error("기본 메뉴 목록을 불러오지 못했어요 (" + response.status + ")");
	}
	return { menus: await response.json(), usedFallback: SUPABASE_CONFIGURED };
}

// DB에서 메뉴를 읽어요. 연결이 안 돼 있거나 비어 있으면 null.
async function loadFromDatabase() {
	const supabase = await getSupabase();
	if (!supabase) {
		return null;
	}
	const { data, error } = await supabase
		.from("menus")
		.select("name, kinds, cuisine, search_terms, exclude_terms, broad_terms, categories, broad_categories")
		.abortSignal(AbortSignal.timeout(5000));
	if (error) {
		throw error;
	}
	return data.length > 0 ? { menus: data, usedFallback: false } : null;
}
