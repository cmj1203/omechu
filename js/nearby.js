import { getSupabase } from "./supabase.js";

const OVERPASS_ENDPOINTS = [
	"https://overpass-api.de/api/interpreter",
	"https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const AMENITIES_BY_KIND = {
	식사: ["restaurant", "fast_food", "food_court"],
	간식: ["cafe", "ice_cream", "fast_food", "restaurant"],
	술: ["bar", "pub", "biergarten", "restaurant"],
};
const SIMILAR_AMENITIES_BY_KIND = {
	식사: ["restaurant", "fast_food"],
	간식: ["cafe", "ice_cream"],
	술: ["bar", "pub", "biergarten"],
};
const BAKERY_SHOPS = ["bakery", "pastry", "confectionery"];
const CUISINE_TAGS = {
	한식: "korean",
	중식: "chinese",
	일식: "japanese|sushi|ramen",
	양식: "italian|pizza|burger|american|french|steak_house|mexican|western|sandwich|경양식",
	아시아: "vietnamese|thai|indian|asian|indonesian|malaysian|nepalese",
};
const SEARCH_RADIUS_METERS = 2000;
const RECOMMEND_FROM_NEAREST = 3;
const MAX_OTHERS = 8;
const WALK_METERS_PER_MINUTE = 67;
const STRAIGHT_TO_WALK_FACTOR = 1.3;

const GEO_ERRORS = {
	1: "위치 권한이 꺼져 있어요. 주소창 왼쪽 아이콘에서 위치를 '허용'으로 바꾸거나, 위치 칸에 동네 이름을 적어 주세요.",
	2: "현재 위치를 알 수 없어요. 기기의 위치 서비스를 켜거나, 위치 칸에 동네 이름을 적어 주세요.",
	3: "위치를 확인하는 데 너무 오래 걸려요. 다시 누르거나, 위치 칸에 동네 이름을 적어 주세요.",
};

export function initNearby(section) {
	const button = section.querySelector("#nearbyBtn");
	const placeInput = section.querySelector("#nearbyPlace");
	const result = section.querySelector("#nearbyResult");
	let menu = null;
	let filterMenus = [];
	let searchId = 0;

	button.addEventListener("click", () => {
		if (!button.disabled) {
			findRestaurants();
		}
	});
	placeInput.addEventListener("keydown", (event) => {
		if (event.key === "Enter" && !button.disabled) {
			findRestaurants();
		}
	});

	return {
		async show(nextMenu, menusForFilters) {
			menu = nextMenu;
			filterMenus = menusForFilters;
			searchId += 1;
			button.disabled = false;
			button.textContent = idleLabel();
			result.replaceChildren();
			section.hidden = false;
			if (placeInput.value.trim() || await locationAlreadyAllowed()) {
				findRestaurants();
			}
		},
		hide() {
			searchId += 1;
			section.hidden = true;
		},
	};

	async function findRestaurants() {
		const id = ++searchId;
		const target = menu;
		const pool = filterMenus;
		const place = placeInput.value.trim();
		try {
			setBusy(place ? "위치 찾는 중…" : "위치 확인 중…");
			const origin = place ? await geocode(place) : await currentPosition();
			setBusy("식당 찾는 중…");
			const found = await searchRestaurants(target, pool, origin);
			if (id === searchId) {
				render(target, origin, found);
			}
		} catch (error) {
			if (id === searchId) {
				showMessage(error.message, target, place);
			}
		} finally {
			if (id === searchId) {
				button.disabled = false;
				button.textContent = idleLabel();
			}
		}
	}

	function idleLabel() {
		return "📍 주변 '" + menu.name + "' 식당 추천";
	}

	function setBusy(label) {
		button.disabled = true;
		button.textContent = label;
	}

	function render(target, origin, found) {
		if (!found.pick) {
			showMessage(origin.label + " 근처 2km 안에서 조건에 맞는 식당을 찾지 못했어요.", target, origin);
			return;
		}
		const nodes = [];
		if (found.mode === "filter") {
			nodes.push(paragraph("nearby-note", "'" + target.name + "' 파는 곳은 못 찾아서, 같은 조건의 '" + found.pick.menuName + "' 가게를 골랐어요."));
		} else if (found.mode === "similar") {
			nodes.push(paragraph("nearby-note", "조건에 맞는 가게를 못 찾아서, 근처 " + similarLabel(target) + "을 골랐어요."));
		}
		nodes.push(restaurantCard(found.pick, origin));
		if (found.others.length > 0) {
			nodes.push(othersList(found.others, found.mode === "similar" ? "다른 가까운 곳" : "조건에 맞는 다른 가까운 곳"));
		}
		nodes.push(footer(target, origin));
		result.replaceChildren(...nodes);
	}

	function showMessage(text, target, where) {
		result.replaceChildren(paragraph("nearby-message", text), footer(target, where));
	}
}

async function locationAlreadyAllowed() {
	if (!navigator.permissions) {
		return false;
	}
	const status = await navigator.permissions.query({ name: "geolocation" });
	return status.state === "granted";
}

function currentPosition() {
	return new Promise((resolve, reject) => {
		if (!window.isSecureContext || !navigator.geolocation) {
			reject(new Error("현재 위치는 https 주소나 localhost 에서만 쓸 수 있어요. 위치 칸에 동네 이름을 적어 주세요."));
			return;
		}
		navigator.geolocation.getCurrentPosition(
			(position) => resolve({ label: "현재 위치", lat: position.coords.latitude, lng: position.coords.longitude }),
			(error) => reject(new Error(GEO_ERRORS[error.code] || "현재 위치를 가져오지 못했어요. 위치 칸에 동네 이름을 적어 주세요.")),
			{ timeout: 10000, maximumAge: 60000 },
		);
	});
}

async function geocode(place) {
	const url = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({
		q: place,
		format: "json",
		limit: "1",
		countrycodes: "kr",
		"accept-language": "ko",
	});
	const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
	if (!response.ok) {
		throw new Error("동네 위치를 찾지 못했어요. 잠시 후 다시 눌러 주세요.");
	}
	const [first] = await response.json();
	if (!first) {
		throw new Error("'" + place + "' 위치를 찾지 못했어요. 역 이름이나 동 이름으로 적어 주세요.");
	}
	return { label: place, lat: Number(first.lat), lng: Number(first.lon) };
}

async function searchRestaurants(menu, filterMenus, origin) {
	let forMenu;
	let forFilters;
	try {
		[forMenu, forFilters] = await Promise.all([
			searchDatabase(origin, [menu], similarFor(menu)),
			searchDatabase(origin, filterMenus, null),
		]);
	} catch (error) {
		console.warn("식당 DB에서 찾지 못해서 OpenStreetMap 공개 서버로 찾아요.", error);
		forMenu = await searchOverpassForMenu(menu, origin);
		forFilters = forMenu.filter((place) => place.matched);
	}

	const suitable = forFilters
		.map((place) => ({ ...place, menuName: bestMenu(place, filterMenus, menu)?.name }))
		.filter((place) => place.menuName);
	const exact = forMenu
		.filter((place) => place.matched && hasSearchTerm(nameForMenu(place, menu), menu))
		.map((place) => ({ ...place, menuName: menu.name }));
	if (exact.length > 0) {
		const pick = pickNear(exact);
		return { mode: "menu", pick, others: othersExcept(suitable, pick) };
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

async function searchDatabase(origin, menus, similar) {
	const supabase = await getSupabase();
	if (!supabase) {
		throw new Error("Supabase 가 연결되지 않았어요.");
	}
	const kinds = [...new Set(menus.map((item) => item.kind))];
	const { data, error } = await supabase
		.rpc("nearby_places", {
			p_lat: origin.lat,
			p_lng: origin.lng,
			p_radius: SEARCH_RADIUS_METERS,
			p_terms: [...new Set(menus.flatMap(searchTerms))],
			p_amenities: [...new Set(kinds.flatMap((kind) => AMENITIES_BY_KIND[kind]))],
			p_shops: kinds.includes("간식") ? BAKERY_SHOPS : [],
			p_similar_amenities: similar ? similar.amenities : [],
			p_similar_cuisine: similar ? similar.cuisine : null,
		})
		.abortSignal(AbortSignal.timeout(8000));
	if (error) {
		throw error;
	}
	return data.map((row) => ({
		name: row.name,
		amenity: row.amenity,
		shop: row.shop,
		lat: row.lat,
		lng: row.lng,
		distance: row.distance,
		walkMinutes: walkMinutes(row.distance),
		phone: formatPhone(row.phone),
		address: row.address ?? "",
		matched: row.matched,
	}));
}

function similarFor(menu) {
	return {
		amenities: SIMILAR_AMENITIES_BY_KIND[menu.kind],
		cuisine: menu.kind === "식사" ? CUISINE_TAGS[menu.cuisine] : null,
	};
}

function bestMenu(place, filterMenus, recommended) {
	let best = null;
	let bestScore = 0;
	for (const candidate of filterMenus) {
		if (!fitsKind(candidate, place)) {
			continue;
		}
		const name = nameForMenu(place, candidate);
		if (!hasSearchTerm(name, candidate)) {
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
function nameForMenu(place, menu) {
	return (menu.exclude_terms ?? []).reduce(
		(name, term) => name.replaceAll(term.toLowerCase(), " "),
		place.name.toLowerCase(),
	);
}

function hasSearchTerm(name, menu) {
	return name.includes(menu.name.toLowerCase())
		|| searchTerms(menu).some((term) => name.includes(term.toLowerCase()));
}

function fitsKind(menu, place) {
	return AMENITIES_BY_KIND[menu.kind].includes(place.amenity) || (menu.kind === "간식" && BAKERY_SHOPS.includes(place.shop));
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

function placeKey(place) {
	return place.name + "|" + place.lat.toFixed(5) + "|" + place.lng.toFixed(5);
}

function searchTerms(menu) {
	return (menu.search_terms?.length ? menu.search_terms : [menu.name])
		.map((term) => term.replace(/[\\^$.|?*+()[\]{}"%_]/g, ""))
		.filter(Boolean);
}

async function searchOverpassForMenu(menu, origin) {
	const exact = (await searchOverpass(menuQuery(menu, origin), origin))
		.filter((place) => hasSearchTerm(nameForMenu(place, menu), menu));
	if (exact.length > 0) {
		return exact.map((place) => ({ ...place, matched: true }));
	}
	const similar = await searchOverpass(similarQuery(menu, origin), origin);
	return similar.map((place) => ({ ...place, matched: false }));
}

function menuQuery(menu, origin) {
	const byName = "[\"name\"~\"" + searchTerms(menu).join("|") + "\",i]";
	const filters = ["[\"amenity\"~\"^(" + AMENITIES_BY_KIND[menu.kind].join("|") + ")$\"]" + byName];
	if (menu.kind === "간식") {
		filters.push("[\"shop\"~\"^(" + BAKERY_SHOPS.join("|") + ")$\"]" + byName);
	}
	return overpassQuery(origin, filters);
}

function similarQuery(menu, origin) {
	const amenities = "[\"amenity\"~\"^(" + SIMILAR_AMENITIES_BY_KIND[menu.kind].join("|") + ")$\"]";
	const cuisine = menu.kind === "식사" ? "[\"cuisine\"~\"" + CUISINE_TAGS[menu.cuisine] + "\",i]" : "";
	return overpassQuery(origin, [amenities + cuisine + "[\"name\"]"]);
}

function similarLabel(menu) {
	if (menu.kind === "술") {
		return "술집";
	}
	if (menu.kind === "간식") {
		return "카페·디저트 가게";
	}
	return menu.cuisine === "아시아" ? "아시아 음식점" : menu.cuisine + "당";
}

function overpassQuery(origin, filters) {
	const around = "nwr(around:" + SEARCH_RADIUS_METERS + "," + origin.lat.toFixed(4) + "," + origin.lng.toFixed(4) + ")";
	return "[out:json][timeout:20];(" + filters.map((filter) => around + filter + ";").join("") + ");out center tags 80;";
}

async function searchOverpass(query, origin) {
	let lastError = null;
	for (const endpoint of OVERPASS_ENDPOINTS) {
		try {
			const response = await fetch(endpoint, {
				method: "POST",
				body: new URLSearchParams({ data: query }),
				signal: AbortSignal.timeout(20000),
			});
			if (!response.ok) {
				throw new Error("HTTP " + response.status);
			}
			const { elements } = await response.json();
			return elements
				.map((element) => fromOverpass(element, origin))
				.sort((a, b) => a.distance - b.distance);
		} catch (error) {
			lastError = error;
			console.warn("식당 검색 서버가 응답하지 않아서 다음 서버로 넘어가요.", endpoint, error);
		}
	}
	throw new Error("식당 정보를 불러오지 못했어요. 잠시 후 다시 눌러 주세요.", { cause: lastError });
}

function fromOverpass(element, origin) {
	const lat = element.lat ?? element.center.lat;
	const lng = element.lon ?? element.center.lon;
	const tags = element.tags;
	const distance = Math.round(distanceMeters(origin, { lat, lng }));
	return {
		name: tags.name,
		amenity: tags.amenity,
		shop: tags.shop,
		lat,
		lng,
		distance,
		walkMinutes: walkMinutes(distance),
		phone: formatPhone(tags.phone || tags["contact:phone"]),
		address: [tags["addr:city"], tags["addr:district"], tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" "),
	};
}

// 두 좌표 사이의 직선거리(미터), 하버사인 공식
function distanceMeters(a, b) {
	const toRadians = (degrees) => (degrees * Math.PI) / 180;
	const dLat = toRadians(b.lat - a.lat);
	const dLng = toRadians(b.lng - a.lng);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
	return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function walkMinutes(straightMeters) {
	return Math.max(1, Math.round((straightMeters * STRAIGHT_TO_WALK_FACTOR) / WALK_METERS_PER_MINUTE));
}

function formatPhone(raw) {
	return (raw ?? "").replace(/^\+82[\s-]*/, "0").replace(/[\s.]+/g, "-");
}

function restaurantCard(restaurant, origin) {
	const card = document.createElement("div");
	card.className = "restaurant-card";
	card.append(
		paragraph("restaurant-label", "🍽️ 추천 식당" + (restaurant.menuName ? " · " + restaurant.menuName : "")),
		paragraph("restaurant-name", restaurant.name),
		paragraph("restaurant-walk", "🚶 " + origin.label + "에서 도보 약 " + restaurant.walkMinutes + "분 · " + formatDistance(restaurant.distance)),
	);
	const info = [restaurant.address, restaurant.phone].filter(Boolean).join(" · ");
	if (info) {
		card.append(paragraph("restaurant-info", info));
	}
	const links = document.createElement("p");
	links.className = "restaurant-links";
	links.append(
		link("카카오맵 길찾기 ↗", kakaoRouteUrl(origin, restaurant)),
		link("지도에서 보기 ↗", kakaoMapUrl(restaurant)),
	);
	card.append(links);
	return card;
}

function othersList(restaurants, title) {
	const wrapper = document.createElement("div");
	wrapper.className = "others";
	wrapper.append(paragraph("others-title", title));
	const list = document.createElement("ol");
	for (const restaurant of restaurants) {
		const item = document.createElement("li");
		const time = document.createElement("span");
		time.textContent = "도보 약 " + restaurant.walkMinutes + "분 · " + formatDistance(restaurant.distance);
		item.append(link(restaurant.name, kakaoMapUrl(restaurant)));
		if (restaurant.menuName) {
			const tag = document.createElement("em");
			tag.className = "menu-tag";
			tag.textContent = restaurant.menuName;
			item.append(tag);
		}
		item.append(time);
		list.append(item);
	}
	wrapper.append(list);
	return wrapper;
}

function footer(menu, where) {
	const note = document.createElement("p");
	note.className = "nearby-footer";
	const osm = document.createElement("a");
	osm.href = "https://www.openstreetmap.org/copyright";
	osm.target = "_blank";
	osm.rel = "noopener";
	osm.textContent = "OpenStreetMap";
	note.append(
		"도보 시간은 직선거리로 어림한 값이에요 · 식당 정보 © ",
		osm,
		" 기여자 · ",
		link("구글 지도에서 더 찾기 ↗", googleMapsUrl(menu, where)),
	);
	return note;
}

function kakaoMapUrl(restaurant) {
	return "https://map.kakao.com/link/map/" + kakaoLabel(restaurant.name) + "," + restaurant.lat + "," + restaurant.lng;
}

function kakaoRouteUrl(origin, restaurant) {
	return "https://map.kakao.com/link/from/" + kakaoLabel(origin.label) + "," + origin.lat + "," + origin.lng
		+ "/to/" + kakaoLabel(restaurant.name) + "," + restaurant.lat + "," + restaurant.lng;
}

function kakaoLabel(text) {
	return encodeURIComponent(text.replace(/,/g, " "));
}

function googleMapsUrl(menu, where) {
	const base = "https://www.google.com/maps/search/";
	if (typeof where === "object" && where !== null) {
		return base + encodeURIComponent(menu.name) + "/@" + where.lat.toFixed(6) + "," + where.lng.toFixed(6) + ",16z";
	}
	return base + encodeURIComponent(where ? where + " " + menu.name : menu.name);
}

function formatDistance(meters) {
	return meters < 1000 ? meters + "m" : (meters / 1000).toFixed(1) + "km";
}

function paragraph(className, text) {
	const element = document.createElement("p");
	element.className = className;
	element.textContent = text;
	return element;
}

function link(text, href) {
	const anchor = document.createElement("a");
	anchor.href = href;
	anchor.target = "_blank";
	anchor.rel = "noopener";
	anchor.textContent = text;
	return anchor;
}
