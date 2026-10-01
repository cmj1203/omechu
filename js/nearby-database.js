import { getSupabase } from "./supabase.js";
import { AMENITIES_BY_KIND, BAKERY_SHOPS, searchTerms } from "./nearby-menu-matching.js";

export const SEARCH_RADIUS_METERS = 2000;

const WALK_METERS_PER_MINUTE = 67;
const STRAIGHT_TO_WALK_FACTOR = 1.3;

export async function searchDatabase(origin, menus, similar) {
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

export function walkMinutes(straightMeters) {
	return Math.max(1, Math.round((straightMeters * STRAIGHT_TO_WALK_FACTOR) / WALK_METERS_PER_MINUTE));
}

export function formatPhone(raw) {
	return (raw ?? "").replace(/^\+82[\s-]*/, "0").replace(/[\s.]+/g, "-");
}
