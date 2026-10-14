export const AMENITIES_BY_KIND = {
	식사: ["restaurant", "fast_food", "food_court"],
	간식: ["cafe", "ice_cream", "fast_food", "restaurant"],
	술: ["bar", "pub", "biergarten", "restaurant"],
};
export const SIMILAR_AMENITIES_BY_KIND = {
	식사: ["restaurant", "fast_food"],
	간식: ["cafe", "ice_cream"],
	술: ["bar", "pub", "biergarten"],
};
export const BAKERY_SHOPS = ["bakery", "pastry", "confectionery"];
export const CUISINE_TAGS = {
	한식: "korean",
	중식: "chinese",
	일식: "japanese|sushi|ramen",
	양식: "italian|pizza|burger|american|french|steak_house|mexican|western|sandwich|경양식",
	아시아: "vietnamese|thai|indian|asian|indonesian|malaysian|nepalese",
};

// 메뉴는 식사·간식·술 중 여러 종류(kinds)에 들 수 있어서, 가게 종류는 그 종류들을 모두 합쳐요.
export function similarFor(menu) {
	return {
		amenities: [...new Set(menu.kinds.flatMap((kind) => SIMILAR_AMENITIES_BY_KIND[kind]))],
		cuisine: menu.kinds.includes("식사") ? CUISINE_TAGS[menu.cuisine] : null,
	};
}

export function amenitiesFor(menus) {
	return [...new Set(menus.flatMap((menu) => menu.kinds.flatMap((kind) => AMENITIES_BY_KIND[kind])))];
}

export function shopsFor(menus) {
	return menus.some((menu) => menu.kinds.includes("간식")) ? BAKERY_SHOPS : [];
}

export function bestMenu(place, filterMenus, recommended) {
	let best = null;
	let bestScore = 0;
	for (const candidate of filterMenus) {
		if (!fitsKind(candidate, place)) {
			continue;
		}
		const name = nameForMenu(place, candidate);
		if (!hasMainTerm(name, candidate)) {
			continue;
		}
		const score = (name.includes(candidate.name.toLowerCase()) ? 2 : 1) + (candidate === recommended ? 0.5 : 0);
		if (score > bestScore) {
			best = candidate;
			bestScore = score;
		}
	}
	return best;
}

// 제외어 부분을 지운 가게 이름. 커리 메뉴에서 '아우어베이커리'는 '아우어 '가 돼서 '커리'로 안 잡혀요.
export function nameForMenu(place, menu) {
	return (menu.exclude_terms ?? []).reduce(
		(name, term) => name.replaceAll(term.toLowerCase(), " "),
		place.name.toLowerCase(),
	);
}

export function hasSearchTerm(name, menu) {
	return name.includes(menu.name.toLowerCase())
		|| searchTerms(menu).some((term) => name.includes(term.toLowerCase()));
}

// 넓은 말(broad_terms)을 뺀 검색어로 찾아요. 이 말이 이름에 든 가게는 그 메뉴를 주력으로 판다고 봐요.
export function hasMainTerm(name, menu) {
	return name.includes(menu.name.toLowerCase())
		|| mainTerms(menu).some((term) => name.includes(term.toLowerCase()));
}

export function mainTerms(menu) {
	const broad = new Set(broadTerms(menu));
	return searchTerms(menu).filter((term) => !broad.has(term.toLowerCase()));
}

export function broadTermIn(name, menu) {
	return broadTerms(menu).find((term) => name.includes(term)) ?? null;
}

function broadTerms(menu) {
	return (menu.broad_terms ?? []).map((term) => term.toLowerCase());
}

function fitsKind(menu, place) {
	return menu.kinds.some((kind) => AMENITIES_BY_KIND[kind].includes(place.amenity))
		|| (menu.kinds.includes("간식") && BAKERY_SHOPS.includes(place.shop));
}

export function searchTerms(menu) {
	return (menu.search_terms?.length ? menu.search_terms : [menu.name])
		.map((term) => term.replace(/[\\^$.|?*+()[\]{}"%_]/g, ""))
		.filter(Boolean);
}
