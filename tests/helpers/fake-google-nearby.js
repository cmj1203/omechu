// js/place-rating.js 가 구글 지도 SDK 를 붙이면 콜백(window.omechuGoogleMapsReady)이 불려야 평점 찾기가 끝나요.
// happy-dom 은 바깥 스크립트를 받지 않아서 콜백이 영영 안 불리고, 그러면 가게마다 4초를 기다려요.
// nearby 시험에서는 평점을 늘 '구글에서 못 찾음'(null)으로 두려고, SDK 가 바로 준비된 것으로 쳐요.
// place-rating.js 는 처음 준비된 라이브러리를 계속 쓰므로, 다른 시험 파일이 먼저 다른 가짜를 붙였으면 그 가짜가 답해요.
// 그래서 nearby 시험은 평점 값에 기대지 않아요.
const library = {
	Place: {
		searchByText: async () => ({ places: [] }),
	},
};

export function useFakeGoogleNearby() {
	window.google ??= { maps: { importLibrary: async () => library } };
	// 앞서 붙인 SDK 가 콜백을 기다리고 있으면 지금 준비된 것으로 알려요.
	window.omechuGoogleMapsReady?.();
	const head = document.head;
	const append = head.append;
	head.append = (...nodes) => {
		append.apply(head, nodes);
		for (const node of nodes) {
			if (node.tagName === "SCRIPT" && node.src.startsWith("https://maps.googleapis.com/")) {
				queueMicrotask(() => window.omechuGoogleMapsReady?.());
			}
		}
	};
	return () => {
		delete head.append;
	};
}
