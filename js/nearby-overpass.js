import { SEARCH_RADIUS_METERS, formatPhone, walkMinutes } from "./nearby-database.js";
import { AMENITIES_BY_KIND, BAKERY_SHOPS, CUISINE_TAGS, SIMILAR_AMENITIES_BY_KIND, hasSearchTerm, nameForMenu, searchTerms } from "./nearby-menu-matching.js";

const OVERPASS_ENDPOINTS = [
	"https://overpass-api.de/api/interpreter",
	"https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

export async function searchOverpassForMenu(menu, origin) {
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
