// 공개(publishable) 키는 브라우저에 보여도 되는 키예요. 메뉴 추가·수정·삭제는 DB 정책(RLS)이 관리자에게만 허용해요.
const SUPABASE_URL = "https://oullxvfcqmapjacmamco.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_imLZVtJYIhMLleQNG7zlPA_4cQkcUVa";

export const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

const LIBRARY_TIMEOUT_MS = 8000;

let clientPromise = null;

export function getSupabase() {
	if (!SUPABASE_CONFIGURED) {
		return Promise.resolve(null);
	}
	clientPromise ??= Promise.race([
		import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm")
			.then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)),
		new Promise((_, reject) => {
			setTimeout(() => reject(new Error("Supabase 라이브러리를 불러오지 못했어요.")), LIBRARY_TIMEOUT_MS);
		}),
	]).catch((error) => {
		clientPromise = null;
		throw error;
	});
	return clientPromise;
}
