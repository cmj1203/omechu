import { searchDatabase } from "./nearby-database.js";
import { bestMenu, hasSearchTerm, nameForMenu, similarFor } from "./nearby-menu-matching.js";
import { searchOverpassForMenu } from "./nearby-overpass.js";

const RECOMMEND_FROM_NEAREST = 3;
const MAX_OTHERS = 8;

export async function searchRestaurants(menu, filterMenus, origin) {
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
