// 구글 지도 JavaScript 키는 브라우저에 그대로 보이는 공개용 키예요. Google Cloud 콘솔에서 이 사이트 주소(HTTP 리퍼러)와
// Maps JavaScript API·Places API (New)로만 쓰게 묶어 두어야 해요. 비워 두면 평점을 찾지 않고 가까운 순으로만 골라요.
const GOOGLE_MAPS_KEY = "AIzaSyA244zFyylVze0SW0Z_NzW50vqQ4E40Atc";
const SDK_CALLBACK = "omechuGoogleMapsReady";
// Place.isOpen()은 beta 채널에서만 호출할 수 있어요.
const SDK_URL = "https://maps.googleapis.com/maps/api/js?v=beta&loading=async&language=ko&region=KR&callback=" + SDK_CALLBACK + "&key=" + GOOGLE_MAPS_KEY;

// 리뷰가 이만큼은 있어야 평점을 믿고 써요. 적으면 평점이 없는 가게와 같게 봐요.
export const MIN_REVIEWS = 10;
// 오메추 평점: 리뷰 PRIOR_REVIEWS 개만큼 PRIOR_RATING 점을 미리 받아 둔 것으로 치고 구글 평점과 섞어요(베이즈 평균).
// 리뷰가 적을수록 4.0 쪽으로 끌려가서, 리뷰 120개 4.9보다 리뷰 3,000개 4.6이 더 높아요.
const PRIOR_REVIEWS = 100;
export const PRIOR_RATING = 4;
// 상가정보 좌표는 실제 자리와 200m 가까이 어긋나기도 해서 300m 안에서 같은 이름을 찾아요.
const MATCH_RADIUS_METERS = 300;
const LOOKUP_TIMEOUT_MS = 4000;

export const RATINGS_ENABLED = Boolean(GOOGLE_MAPS_KEY);

let sdk = null;
const cache = new Map();

// 가게마다 { rating, reviews, openNow, closedForGood, hours } 를, 구글에서 같은 가게를 못 찾으면 null 을,
// 묻지 못했으면(키 없음·오류·시간 초과) undefined 를 돌려줘요. rating 은 평점이 없으면 null,
// openNow 는 지금 영업 중이면 true, 아니면 false, 영업시간을 모르면 undefined 예요.
// hours 는 휴일 예외를 반영한 오늘 영업시간 글("11:00~21:00", 쉬는 시간이 있으면 ", "로 이어요)이고, 모르거나 오늘 쉬면 null 이에요.
// 같은 가게는 이 화면을 연 동안 다시 묻지 않아요(실패한 가게는 다음에 다시 물어요).
export function lookupRatings(places) {
	return Promise.all(places.map((place) => lookupRating(place)));
}

function lookupRating(place) {
	if (!RATINGS_ENABLED) {
		return Promise.resolve(undefined);
	}
	const key = place.name + "|" + place.lat + "|" + place.lng;
	if (!cache.has(key)) {
		cache.set(key, withTimeout(findRating(place)).catch((error) => {
			console.warn("구글 평점을 찾지 못했어요: " + place.name, error);
			cache.delete(key);
			return undefined;
		}));
	}
	return cache.get(key);
}

// 리뷰가 MIN_REVIEWS 개 이상일 때만 오메추 평점을, 아니면 null 을 돌려줘요.
export function omechuRating(found) {
	if (!found || typeof found.rating !== "number" || found.reviews < MIN_REVIEWS) {
		return null;
	}
	return (found.reviews * found.rating + PRIOR_REVIEWS * PRIOR_RATING) / (found.reviews + PRIOR_REVIEWS);
}

async function findRating(place) {
	const { Place } = await loadPlaces();
	const { places } = await Place.searchByText({
		textQuery: place.name,
		fields: ["displayName", "location", "rating", "userRatingCount", "businessStatus", "regularOpeningHours", "currentOpeningHours", "utcOffsetMinutes"],
		locationBias: { center: { lat: place.lat, lng: place.lng }, radius: MATCH_RADIUS_METERS },
		maxResultCount: 5,
	});
	const name = compactName(place.name);
	const same = places.find((candidate) => {
		const other = compactName(candidate.displayName ?? "");
		return other && (other.includes(name) || name.includes(other))
			&& metersBetween(place, { lat: candidate.location.lat(), lng: candidate.location.lng() }) <= MATCH_RADIUS_METERS;
	});
	if (!same) {
		return null;
	}
	const closedForGood = same.businessStatus === "CLOSED_PERMANENTLY";
	return {
		rating: typeof same.rating === "number" ? same.rating : null,
		reviews: same.userRatingCount ?? 0,
		openNow: closedForGood ? false : await openNow(same),
		closedForGood,
		hours: todayHours(same.currentOpeningHours, same.utcOffsetMinutes),
	};
}

// 가게 현지 날짜의 영업시간. 전날부터 이어진 영업은 자정부터 표시해요.
// 구글은 24시간 영업을 일요일 자정에 열고 닫는 시각이 없는 기간으로 표시해요.
function todayHours(openingHours, utcOffsetMinutes) {
	const periods = openingHours?.periods;
	if (!Array.isArray(periods)) {
		return null;
	}
	if (periods.some((period) => period.open?.day === 0 && period.open.hour === 0 && period.open.minute === 0 && !period.close)) {
		return "24시간";
	}
	if (typeof utcOffsetMinutes !== "number") {
		return null;
	}
	const today = new Date(Date.now() + utcOffsetMinutes * 60000).getUTCDay();
	const spans = periods
		.flatMap(({ open, close }) => {
			if (!open || !close) {
				return [];
			}
			const elapsedDays = (today - open.day + 7) % 7;
			const durationDays = (close.day - open.day + 7) % 7;
			if (elapsedDays > durationDays) {
				return [];
			}
			if (elapsedDays === 0) {
				return [{ start: open.hour * 60 + open.minute, text: clock(open) + "~" + clock(close) }];
			}
			if (elapsedDays < durationDays) {
				return [{ start: 0, text: "24시간" }];
			}
			return close.hour === 0 && close.minute === 0
				? [] : [{ start: 0, text: "00:00~" + clock(close) }];
		})
		.sort((a, b) => a.start - b.start);
	return spans.length > 0 ? spans.map((span) => span.text).join(", ") : null;
}

function clock(point) {
	return String(point.hour).padStart(2, "0") + ":" + String(point.minute).padStart(2, "0");
}

// 영업시간이 없거나 모르면 undefined. 임시 휴업도 문 닫은 것으로 봐요.
async function openNow(place) {
	if (place.businessStatus === "CLOSED_TEMPORARILY") {
		return false;
	}
	try {
		return await place.isOpen();
	} catch {
		return undefined;
	}
}

// 지금 문을 닫았거나(영업시간 밖·임시 휴업·폐업) 그렇게 알려진 가게면 true
export function knownClosed(found) {
	return found?.openNow === false;
}

function loadPlaces() {
	sdk ??= new Promise((resolve, reject) => {
		window[SDK_CALLBACK] = () => resolve();
		const script = document.createElement("script");
		script.src = SDK_URL;
		script.async = true;
		script.onerror = () => reject(new Error("구글 지도를 불러오지 못했어요."));
		document.head.append(script);
	}).then(() => window.google.maps.importLibrary("places")).catch((error) => {
		sdk = null;
		throw error;
	});
	return sdk;
}

function withTimeout(promise) {
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			setTimeout(() => reject(new Error("구글 장소 검색이 " + LOOKUP_TIMEOUT_MS / 1000 + "초 안에 끝나지 않았어요.")), LOOKUP_TIMEOUT_MS);
		}),
	]);
}

function compactName(name) {
	return name.toLowerCase().replace(/\s/g, "");
}

function metersBetween(a, b) {
	const dy = (a.lat - b.lat) * 111000;
	const dx = (a.lng - b.lng) * 111000 * Math.cos((a.lat * Math.PI) / 180);
	return Math.hypot(dx, dy);
}
