// 여러 시험 파일이 함께 쓰는 모듈 안의 상태를, 어느 파일이 먼저 돌든 같은 값으로 맞춰 둬요(tests/helpers/dom.js 가 불러요).
// - js/place-rating.js 는 처음 준비된 구글 라이브러리를 끝까지 써요. 콜백을 안 부르면 가게마다 4초를 기다리므로,
//   구글 SDK 스크립트가 붙으면 바로 준비 신호를 보내고 평점은 늘 '구글에서 못 찾음'으로 답하는 가짜를 둬요.
// - js/member.js 의 favoriteIds·excludedMenus 는 처음 부른 결과를 끝까지 써요. 로그인한 빈 회원으로 먼저 불러 두어
//   늘 빈 Set 으로 시작하게 해요. 이 Set 에 넣은 것은 그 시험이 비워야 해요.
import { useFakeSupabase, useNoSupabase } from "./fake-supabase.js";
import { excludedMenus, favoriteIds } from "../../js/member.js";

export const sharedGoogle = {
	maps: {
		importLibrary: async () => ({ Place: { searchByText: async () => ({ places: [] }) } }),
	},
};

export function restoreSharedGoogle() {
	window.google = sharedGoogle;
}

restoreSharedGoogle();
new MutationObserver((records) => {
	for (const record of records) {
		for (const node of record.addedNodes) {
			if (node.tagName === "SCRIPT" && node.src?.startsWith("https://maps.googleapis.com/")) {
				queueMicrotask(() => window.omechuGoogleMapsReady?.());
			}
		}
	}
}).observe(document.head, { childList: true });

useFakeSupabase({
	session: { user: { id: "shared-member", email: "shared@example.com" } },
	tables: {
		favorite_places: { data: [], error: null },
		excluded_menus: { data: [], error: null },
	},
});
export const sharedFavorites = await favoriteIds();
export const sharedExcluded = await excludedMenus();
useNoSupabase();
