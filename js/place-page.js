import { recordView } from "./member.js";
import { loadKakao } from "./place-picker.js";

// 상가정보 좌표는 카카오 좌표와 200m 가까이 어긋나기도 해서 300m 안에서 같은 이름을 찾아요.
const SEARCH_RADIUS_METERS = 300;
const LOOKUP_TIMEOUT_MS = 4000;
const pageUrls = new Map();

// 가게 이름을 누르면 그 가게의 카카오 장소 페이지(메뉴·사진·후기)를 새 창으로 열어요.
// 카카오에서 못 찾으면 네이버에서 '이름 주소'로 찾은 결과를 열어요.
export function placeNameLink(place) {
	const anchor = document.createElement("a");
	anchor.className = "place-name-link";
	anchor.href = naverSearchUrl(place);
	anchor.target = "_blank";
	anchor.rel = "noopener";
	anchor.textContent = place.name;
	anchor.addEventListener("click", (event) => {
		event.preventDefault();
		openPlacePage(place);
		recordView(place);
	});
	return anchor;
}

function openPlacePage(place) {
	const key = place.name + "|" + place.lat + "|" + place.lng;
	if (pageUrls.has(key)) {
		window.open(pageUrls.get(key), "_blank", "noopener");
		return;
	}
	// 카카오에서 찾는 동안 기다리면 브라우저가 새 창을 막아서, 누른 순간 빈 창을 먼저 열어 둬요.
	const win = window.open("", "_blank");
	if (win) {
		win.opener = null;
	}
	placePageUrl(place).then((url) => {
		pageUrls.set(key, url);
		if (win && !win.closed) {
			win.location.href = url;
		} else {
			window.location.href = url;
		}
	});
}

async function placePageUrl(place) {
	try {
		const kakao = await withTimeout(loadKakao());
		const found = await withTimeout(new Promise((resolve) => {
			new kakao.maps.services.Places().keywordSearch(
				place.name,
				(data, status) => resolve(status === kakao.maps.services.Status.OK ? data : []),
				{ x: place.lng, y: place.lat, radius: SEARCH_RADIUS_METERS, sort: kakao.maps.services.SortBy.DISTANCE },
			);
		}));
		if (found.length > 0) {
			return found[0].place_url.replace(/^http:/, "https:");
		}
	} catch (error) {
		console.warn("카카오에서 가게를 찾지 못해서 네이버 검색으로 열어요.", error);
	}
	return naverSearchUrl(place);
}

function withTimeout(promise) {
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			setTimeout(() => reject(new Error("카카오 장소 검색이 " + LOOKUP_TIMEOUT_MS / 1000 + "초 안에 끝나지 않았어요.")), LOOKUP_TIMEOUT_MS);
		}),
	]);
}

function naverSearchUrl(place) {
	return "https://search.naver.com/search.naver?query=" + encodeURIComponent([place.name, place.address].filter(Boolean).join(" "));
}
