import { SEARCH_RADIUS_METERS, WIDER_RADIUS_METERS, searchDatabase } from "./nearby-database.js";
import { bestMenu, broadTermIn, categoryLabel, hasMainTerm, isMainPlace, isMenuPlace, isOtherMenuPlace, mainCategories, mainTerms, nameForMenu, searchTerms, similarFor } from "./nearby-menu-matching.js";
import { searchOverpassForMenu } from "./nearby-overpass.js";
import { PRIOR_RATING, knownClosed, lookupRatings, omechuRating } from "./place-rating.js";

const RECOMMEND_FROM_NEAREST = 3;
// 평점 우선은 가까운 10곳의 오메추 평점을 보고 1등과 0.1점 안쪽인 곳(최대 3곳) 중 하나를 골라요.
// 평점이 없거나 리뷰가 적은 가게는 PRIOR_RATING(4.0)으로 봐서, 평점을 못 불러오면 가까운 순과 같아져요.
const RATED_CANDIDATES = 10;
const TOP_RATING_MARGIN = 0.1;
const MAX_OTHERS = 8;
const MAX_LIST = 30;
const SAME_PLACE_METERS = 20;
const HANGUL = /[가-힣]/;
const ALL_KINDS = ["식사", "간식", "술"];

// order 는 "rating"(평점 우선, 기본) 또는 "distance"(거리 우선)예요. 거리 우선도 평점은 표시하려고 물어봐요.
// shown 은 '다른 가게'로 이미 보여 준 가게(placeKey)예요. 그 가게들은 빼고 고르고, 다 보여 줬으면 처음부터 다시 골라요.
export async function searchRestaurants(menu, filterMenus, origin, order = "rating", shown = new Set()) {
	const found = await searchCandidates(menu, filterMenus, origin);
	const { forMenu, forFilters, ...result } = found;
	const byRating = order === "rating";
	const picker = byRating ? pickTopRated : pickNearRandom;
	// 남은 가게가 모두 지금 문 닫은 곳이면, 문 닫은 곳을 추천하지 않고 처음부터 다시 골라요.
	const pickFrom = async (places) => {
		const fresh = places.filter((place) => !shown.has(placeKey(place)));
		if (fresh.length === 0 || fresh.length === places.length) {
			return picker(places);
		}
		const pick = await picker(fresh);
		return knownClosed(pick.googleRating) ? picker(places) : pick;
	};
	const chosen = await choose(menu, filterMenus, forMenu, forFilters, pickFrom);
	const [pick] = chosen.pick ? await withRatings([chosen.pick]) : [null];
	const others = await withRatings(chosen.others);
	// 다른 가까운 곳 목록은 평점 우선이면 오메추 평점 순, 거리 우선이면 가까운 순이고, 지금 문 닫은 가게는 맨 뒤로 보내요.
	const ordered = byRating ? others.sort(byOmechuRating) : others;
	const closed = ordered.filter((place) => knownClosed(place.googleRating));
	return { ...result, ...chosen, pick, others: [...ordered.filter((place) => !closed.includes(place)), ...closed] };
}

// 어느 반경의 어떤 가게들로 고를지 정해요. 여기서는 평점을 묻지 않고, 정한 가게들로만 평점을 봐요.
async function searchCandidates(menu, filterMenus, origin) {
	let forMenu;
	let forFilters;
	let fromDatabase = true;
	try {
		[forMenu, forFilters] = await Promise.all([
			searchDatabase(origin, [menu], similarFor(menu)),
			searchDatabase(origin, filterMenus, null, SEARCH_RADIUS_METERS, mainTerms, mainCategories),
		]);
	} catch (error) {
		console.warn("식당 DB에서 찾지 못해서 OpenStreetMap 공개 서버로 찾아요.", error);
		fromDatabase = false;
		forMenu = await searchOverpassForMenu(menu, origin);
		forFilters = forMenu.filter((place) => place.matched);
	}
	const near = { forMenu, forFilters, searchedKm: SEARCH_RADIUS_METERS / 1000 };
	const nearMode = (await choose(menu, filterMenus, forMenu, forFilters, pickNearest)).mode;
	if (nearMode === "menu" || nearMode === "broad" || nearMode === "filter" || !fromDatabase) {
		return near;
	}
	// 2km 안에 메뉴·조건에 맞는 가게가 없으면 5km까지 넓혀서 다시 찾아요. 비슷한 가게는 2km 안 결과를 그대로 써요.
	try {
		const [widerMenu, widerFilters] = await Promise.all([
			searchDatabase(origin, [menu], null, WIDER_RADIUS_METERS),
			searchDatabase(origin, filterMenus, null, WIDER_RADIUS_METERS, mainTerms, mainCategories),
		]);
		const widerMode = (await choose(menu, filterMenus, widerMenu, widerFilters, pickNearest)).mode;
		if (widerMode === "menu" || widerMode === "broad" || widerMode === "filter") {
			return { forMenu: widerMenu, forFilters: widerFilters, wider: true, searchedKm: WIDER_RADIUS_METERS / 1000 };
		}
	} catch (error) {
		console.warn("5km까지 넓혀 찾지 못했어요.", error);
		return near;
	}
	return { ...near, searchedKm: WIDER_RADIUS_METERS / 1000 };
}

// 가게·메뉴 검색: 메뉴가 정해졌으면 그 메뉴를 주력으로 파는 가게를, 아니면 이름에 그 말이 든 가게를
// 가까운 순으로 최대 30곳 보여 줘요. 메뉴가 하나뿐이면 모두 같은 메뉴라 목록의 메뉴 표시는 빼요.
export async function searchStores(query, menus, origin) {
	const found = menus.length > 0 ? await listRestaurants(menus, origin) : await searchByName(query, origin);
	return menus.length > 1 ? found : { ...found, places: found.places.map(({ menuName, ...place }) => place) };
}

// '김밥 천국'처럼 띄어 친 말은 붙여 쓴 이름 '김밥천국'도 찾아요.
async function searchByName(query, origin) {
	const terms = [...new Set([query, query.replace(/\s+/g, "")])];
	const byName = { name: query, kinds: ALL_KINDS, search_terms: terms };
	for (const radius of [SEARCH_RADIUS_METERS, WIDER_RADIUS_METERS]) {
		let found;
		try {
			found = await searchDatabase(origin, [byName], null, radius, searchTerms, () => []);
		} catch (error) {
			throw new Error("가게를 찾지 못했어요. 잠시 후 다시 찾아 주세요.", { cause: error });
		}
		const places = withoutDuplicates(found.filter((place) => place.matched).map((place) => ({ ...place, menuName: query })))
			.sort((a, b) => a.distance - b.distance)
			.slice(0, MAX_LIST);
		if (places.length > 0 || radius === WIDER_RADIUS_METERS) {
			return { places, wider: radius === WIDER_RADIUS_METERS, searchedKm: radius / 1000 };
		}
	}
}

// 메뉴 하나 또는 여러 메뉴를 주력으로 파는 가게를 가까운 순으로 최대 30곳. 2km 안에 없으면 5km까지 찾아요.
export async function listRestaurants(filterMenus, origin) {
	for (const radius of [SEARCH_RADIUS_METERS, WIDER_RADIUS_METERS]) {
		let found;
		try {
			found = await searchDatabase(origin, filterMenus, null, radius, mainTerms, mainCategories);
		} catch (error) {
			throw new Error("가게 목록을 불러오지 못했어요. 잠시 후 다시 눌러 주세요.", { cause: error });
		}
		const places = withoutDuplicates(found
			.map((place) => ({ ...place, menuName: bestMenu(place, filterMenus, null)?.name }))
			.filter((place) => place.menuName))
			.sort((a, b) => a.distance - b.distance)
			.slice(0, MAX_LIST);
		if (places.length > 0 || radius === WIDER_RADIUS_METERS) {
			return { places, wider: radius === WIDER_RADIUS_METERS, searchedKm: radius / 1000 };
		}
	}
}

async function choose(menu, filterMenus, forMenu, forFilters, pickFrom) {
	const suitable = withoutDuplicates(forFilters
		.map((place) => ({ ...place, menuName: bestMenu(place, filterMenus, menu)?.name }))
		.filter((place) => place.menuName));
	// 이름에 메뉴 검색어가 들었거나 업종이 맞는 가게 중, 주력(주력 검색어·주력 업종)인 곳을 먼저 골라요.
	// 넓은 말·넓은 업종만 맞는 곳(김치찌개의 '찌개'집, 국/탕/찌개류 가게 등)은 주력 가게가 없을 때만 골라요.
	const named = forMenu
		.filter((place) => place.matched && isMenuPlace(place, menu))
		.map((place) => ({ ...place, menuName: menu.name }));
	// 업종은 상가정보에 잘못 올라 있기도 해서(피자 업종의 샐러드 가게 등), 이름으로 맞는 주력 가게를 먼저 쓰고 업종으로만 맞는 가게는 그 뒤에 둬요.
	const mainByName = withoutDuplicates(named.filter((place) => hasMainTerm(nameForMenu(place, menu), menu)));
	const mainByCategory = withoutDuplicates(named.filter((place) => !hasMainTerm(nameForMenu(place, menu), menu) && isMainPlace(place, menu)));
	const exact = [...mainByName, ...mainByCategory];
	const broadAll = withoutDuplicates(named.filter((place) => !isMainPlace(place, menu)));
	// 넓은 업종으로만 맞는 다른 메뉴 가게(김치찌개의 '잣고을곰탕')는 다른 가게가 없을 때만 써요.
	// 칼국수의 '시골잔치국수'처럼 그것밖에 없으면 엉뚱한 메뉴보다는 나아서요.
	const broadPlain = broadAll.filter((place) => !isOtherMenuPlace(place, menu));
	const broad = broadPlain.length > 0 ? broadPlain : broadAll;
	if (exact.length > 0) {
		const pick = await pickFrom(mainByName.length > 0 ? mainByName : mainByCategory);
		// 다른 가까운 곳도 같은 메뉴를 파는 가게로 보여 줘요. 같은 메뉴 가게가 이 한 곳뿐이면 조건에 맞는 다른 메뉴 가게를 보여 줘요.
		// 같은 메뉴 목록에서는 메뉴 이름 표시가 되풀이되니 빼요.
		const sameMenu = [...othersExcept(mainByName, pick), ...othersExcept(mainByCategory, pick)]
			.slice(0, MAX_OTHERS)
			.map(({ menuName, ...place }) => place);
		if (sameMenu.length > 0) {
			return { mode: "menu", pick, others: sameMenu, othersSameMenu: true };
		}
		// 주력 가게가 이 한 곳뿐이면, 넓은 말 가게(잔치국수의 '국수'집 등)를 먼저 보여 줘요.
		if (broad.length > 0) {
			return { mode: "menu", pick, others: othersExcept(broad, pick).map(({ menuName, ...place }) => place), othersBroad: true };
		}
		return { mode: "menu", pick, others: othersExcept(suitable, pick) };
	}
	if (broad.length > 0) {
		const pick = await pickFrom(broad);
		const others = othersExcept(broad, pick).map(({ menuName, ...place }) => place);
		const broadTerm = broadTermIn(nameForMenu(pick, menu), menu);
		const broadCategory = broadTerm ? null : categoryLabel(pick.category);
		return others.length > 0
			? { mode: "broad", pick, broadTerm, broadCategory, others }
			: { mode: "broad", pick, broadTerm, broadCategory, others: othersExcept(suitable, pick) };
	}
	if (suitable.length > 0) {
		const pick = await pickFrom(suitable);
		return { mode: "filter", pick, others: othersExcept(suitable, pick) };
	}
	const similar = forMenu.filter((place) => !place.matched);
	if (similar.length > 0) {
		const pick = await pickFrom(similar);
		return { mode: "similar", pick, others: othersExcept(similar, pick) };
	}
	return { mode: "none", pick: null, others: [] };
}

// 어느 경우(메뉴·넓은 말·조건·비슷한 가게)인지만 볼 때 써요. 평점을 묻지 않아요.
function pickNearest(places) {
	return places[0];
}

// 거리 우선: 가까운 3곳 중 하나를 골라요. 지금 문 닫은 가게는 다른 가게가 없을 때만 골라요.
async function pickNearRandom(places) {
	const nearest = openFirst(await withRatings(nearestOf(places))).slice(0, RECOMMEND_FROM_NEAREST);
	return nearest[Math.floor(Math.random() * nearest.length)];
}

// 평점 우선: 가까운 10곳 중 오메추 평점이 1등과 0.1점 안쪽인 곳(최대 3곳)에서 하나를 골라요.
// 지금 문 닫은 가게는 다른 가게가 없을 때만 골라요.
async function pickTopRated(places) {
	const rated = openFirst(await withRatings(nearestOf(places))).sort(byOmechuRating);
	const top = ratingScore(rated[0]);
	const best = rated.filter((place) => ratingScore(place) >= top - TOP_RATING_MARGIN).slice(0, RECOMMEND_FROM_NEAREST);
	return best[Math.floor(Math.random() * best.length)];
}

function nearestOf(places) {
	return [...places].sort((a, b) => a.distance - b.distance).slice(0, RATED_CANDIDATES);
}

// 영업 중이거나 영업시간을 모르는 가게만 남겨요. 모두 문 닫았으면 그대로 둬요(가까운 순 유지).
function openFirst(places) {
	const open = places.filter((place) => !knownClosed(place.googleRating));
	return open.length > 0 ? open : places;
}

// 오메추 평점이 높은 순, 같으면 가까운 순
function byOmechuRating(a, b) {
	return ratingScore(b) - ratingScore(a) || a.distance - b.distance;
}

function ratingScore(place) {
	return omechuRating(place.googleRating) ?? PRIOR_RATING;
}

// googleRating 은 lookupRatings 가 돌려준 값이에요(평점·리뷰 수, 없으면 null, 못 찾았으면 undefined).
async function withRatings(places) {
	const ratings = await lookupRatings(places);
	return places.map((place, index) => ({ ...place, googleRating: ratings[index] }));
}

function othersExcept(places, pick) {
	const pickKey = placeKey(pick);
	return places
		.filter((place) => placeKey(place) !== pickKey)
		.sort((a, b) => a.distance - b.distance)
		.slice(0, MAX_OTHERS);
}

// 같은 가게가 두 번 올라와 있으면 하나만 남겨요. 지도 자료에 영어 이름과 한글 이름으로 따로 있거나,
// '시청역 봉평막국수'와 '시청역봉평막국수'처럼 띄어쓰기만 다르게 있어요.
// 같은 메뉴로 걸렸고 서로 20m 안이며, 띄어쓴 이름 한쪽이 다른 쪽에 들어 있거나 한쪽 이름에 한글이 없으면 같은 가게로 봐요.
// 남길 때는 주소가 있는 쪽을 고르고, 공무원 단골 횟수는 큰 쪽을 써요.
function withoutDuplicates(places) {
	const kept = [];
	for (const place of [...places].sort((a, b) => a.distance - b.distance)) {
		const index = kept.findIndex((other) => samePlace(other, place));
		if (index === -1) {
			kept.push(place);
			continue;
		}
		const other = kept[index];
		const better = !other.address && place.address ? place : other;
		kept[index] = { ...better, officialVisits: Math.max(other.officialVisits ?? 0, place.officialVisits ?? 0) };
	}
	return kept;
}

function samePlace(a, b) {
	if (a.menuName !== b.menuName || metersBetween(a, b) > SAME_PLACE_METERS) {
		return false;
	}
	const nameA = compactName(a.name);
	const nameB = compactName(b.name);
	return nameA.includes(nameB) || nameB.includes(nameA) || !HANGUL.test(a.name) || !HANGUL.test(b.name);
}

function compactName(name) {
	return name.toLowerCase().replace(/\s/g, "");
}

function metersBetween(a, b) {
	const dy = (a.lat - b.lat) * 111000;
	const dx = (a.lng - b.lng) * 111000 * Math.cos((a.lat * Math.PI) / 180);
	return Math.hypot(dx, dy);
}

export function placeKey(place) {
	return place.name + "|" + place.lat.toFixed(5) + "|" + place.lng.toFixed(5);
}
