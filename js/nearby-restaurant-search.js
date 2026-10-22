import { SEARCH_RADIUS_METERS, WIDER_RADIUS_METERS, searchDatabase } from "./nearby-database.js";
import { bestMenu, broadTermIn, categoryLabel, hasMainTerm, isMainPlace, isMenuPlace, isOtherMenuPlace, mainCategories, mainTerms, nameForMenu, similarFor } from "./nearby-menu-matching.js";
import { searchOverpassForMenu } from "./nearby-overpass.js";

const RECOMMEND_FROM_NEAREST = 3;
const MAX_OTHERS = 8;
const MAX_LIST = 30;
const SAME_PLACE_METERS = 20;
const HANGUL = /[가-힣]/;

export async function searchRestaurants(menu, filterMenus, origin) {
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
	const near = choose(menu, filterMenus, forMenu, forFilters);
	if (near.mode === "menu" || near.mode === "broad" || near.mode === "filter" || !fromDatabase) {
		return { ...near, searchedKm: SEARCH_RADIUS_METERS / 1000 };
	}
	// 2km 안에 메뉴·조건에 맞는 가게가 없으면 5km까지 넓혀서 다시 찾아요. 비슷한 가게는 2km 안 결과를 그대로 써요.
	try {
		const [widerMenu, widerFilters] = await Promise.all([
			searchDatabase(origin, [menu], null, WIDER_RADIUS_METERS),
			searchDatabase(origin, filterMenus, null, WIDER_RADIUS_METERS, mainTerms, mainCategories),
		]);
		const wider = choose(menu, filterMenus, widerMenu, widerFilters);
		if (wider.mode === "menu" || wider.mode === "broad" || wider.mode === "filter") {
			return { ...wider, wider: true, searchedKm: WIDER_RADIUS_METERS / 1000 };
		}
	} catch (error) {
		console.warn("5km까지 넓혀 찾지 못했어요.", error);
		return { ...near, searchedKm: SEARCH_RADIUS_METERS / 1000 };
	}
	return { ...near, searchedKm: WIDER_RADIUS_METERS / 1000 };
}

// 가게 목록: 고른 조건의 메뉴를 주력으로 파는 가게를 가까운 순으로 최대 30곳. 2km 안에 없으면 5km까지 찾아요.
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

function choose(menu, filterMenus, forMenu, forFilters) {
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
		const pick = pickNear(mainByName.length > 0 ? mainByName : mainByCategory);
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
		const pick = pickNear(broad);
		const others = othersExcept(broad, pick).map(({ menuName, ...place }) => place);
		const broadTerm = broadTermIn(nameForMenu(pick, menu), menu);
		const broadCategory = broadTerm ? null : categoryLabel(pick.category);
		return others.length > 0
			? { mode: "broad", pick, broadTerm, broadCategory, others }
			: { mode: "broad", pick, broadTerm, broadCategory, others: othersExcept(suitable, pick) };
	}
	if (suitable.length > 0) {
		const pick = pickNear(suitable);
		return { mode: "filter", pick, others: othersExcept(suitable, pick) };
	}
	const similar = forMenu.filter((place) => !place.matched);
	if (similar.length > 0) {
		const pick = pickNear(similar);
		return { mode: "similar", pick, others: othersExcept(similar, pick) };
	}
	return { mode: "none", pick: null, others: [] };
}

function pickNear(places) {
	return places[Math.floor(Math.random() * Math.min(RECOMMEND_FROM_NEAREST, places.length))];
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

function placeKey(place) {
	return place.name + "|" + place.lat.toFixed(5) + "|" + place.lng.toFixed(5);
}
