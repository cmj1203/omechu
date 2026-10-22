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
		if (!isMainPlace(place, candidate)) {
			continue;
		}
		const name = nameForMenu(place, candidate);
		// 이름에 메뉴 이름이 그대로 있으면 2, 다른 검색어면 1, 업종으로만 맞으면 0.5 (이름으로 맞는 메뉴를 먼저 붙여요)
		const byName = name.includes(candidate.name.toLowerCase()) ? 2 : hasMainTerm(name, candidate) ? 1 : 0.5;
		const score = byName + (candidate === recommended ? 0.25 : 0);
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

// 상가정보 업종('중분류/소분류')으로도 메뉴 가게를 알아봐요. 이름에 메뉴 글자가 없는 'BHC' 같은 가게도 업종이 '치킨'이면 치킨 가게예요.
// categories 는 그 메뉴가 주력인 업종(치킨, 중국집), broad_categories 는 넓은 업종(국/탕/찌개류, 분식)이에요.
// 이름에 제외어가 든 가게(김치찌개의 '부대찌개'집)는 업종으로도 잡지 않아요.
export function isMainPlace(place, menu) {
	const name = nameForMenu(place, menu);
	return hasMainTerm(name, menu)
		|| (name === place.name.toLowerCase() && (menu.categories ?? []).includes(place.category));
}

export function isMenuPlace(place, menu) {
	const name = nameForMenu(place, menu);
	return hasSearchTerm(name, menu)
		|| (name === place.name.toLowerCase() && menuCategories([menu]).includes(place.category));
}

// 넓은 업종으로만 맞았는데 이름으로 보아 다른 메뉴 가게인지 봐요. 김치찌개의 '국/탕/찌개류'에는 '잣고을곰탕'·'장터국밥'도 들어 있어요.
// 그 업종이 주력인 메뉴(백반/한정식의 백반·밥집)의 검색어는 그 업종 가게답게 하는 이름이라 세지 않아요.
export function isOtherMenuPlace(place, menu) {
	if (hasSearchTerm(nameForMenu(place, menu), menu) || !(menu.broad_categories ?? []).includes(place.category)) {
		return false;
	}
	const name = place.name.toLowerCase();
	return allMenus.some((other) => other.name !== menu.name
		&& !(other.categories ?? []).includes(place.category)
		&& hasMainTerm(name, other));
}

let allMenus = [];

// 넓은 업종 가게가 다른 메뉴 가게인지 보려면 전체 메뉴가 필요해서, 메뉴를 불러온 뒤 한 번 넘겨줘요.
export function rememberMenus(menus) {
	allMenus = menus;
}

export function mainCategories(menus) {
	return [...new Set(menus.flatMap((menu) => menu.categories ?? []))];
}

export function menuCategories(menus) {
	return [...new Set(menus.flatMap((menu) => [...(menu.categories ?? []), ...(menu.broad_categories ?? [])]))];
}

// '한식/국/탕/찌개류' → '국/탕/찌개류'
export function categoryLabel(category) {
	return category ? category.split("/").slice(1).join("/") : null;
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
