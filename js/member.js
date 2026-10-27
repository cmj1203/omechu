import { getSupabase } from "./supabase.js";

// 일반 회원의 즐겨찾기와 최근 본 가게(favorite_places, recent_places 표). 로그인하지 않았으면 아무것도 저장하지 않아요.
// 가게는 이름·좌표로 알아봐요(검색 결과에 가게 번호가 없어서요).
const RECENT_LIMIT = 30;

let favorites = null;

export function placeId(place) {
	return place.name + "|" + place.lat + "|" + place.lng;
}

// 로그인한 회원이면 { supabase, user }, 아니면 null
export async function signedIn() {
	try {
		const supabase = await getSupabase();
		if (!supabase) {
			return null;
		}
		const { data } = await supabase.auth.getSession();
		return data.session ? { supabase, user: data.session.user } : null;
	} catch {
		return null;
	}
}

// 즐겨찾기한 가게의 placeId 묶음. 로그인하지 않았으면 null 이에요. 한 화면에서 한 번만 불러와요.
export function favoriteIds() {
	favorites ??= (async () => {
		const member = await signedIn();
		if (!member) {
			return null;
		}
		const { data, error } = await member.supabase.from("favorite_places").select("name, lat, lng");
		if (error) {
			console.warn("즐겨찾기를 불러오지 못했어요.", error);
			return new Set();
		}
		return new Set(data.map(placeId));
	})();
	return favorites;
}

// on 이면 즐겨찾기에 넣고, 아니면 빼요. 로그인하지 않았으면 "signed-out", 실패하면 오류를 던져요.
export async function setFavorite(place, on) {
	const member = await signedIn();
	if (!member) {
		return "signed-out";
	}
	const table = member.supabase.from("favorite_places");
	const { error } = on
		? await table.insert(placeRow(place))
		: await table.delete().eq("name", place.name).eq("lat", place.lat).eq("lng", place.lng);
	// 이미 넣어 둔 가게(다른 창에서 넣음)면 넣은 것으로 봐요.
	if (error && error.code !== "23505") {
		throw error;
	}
	const ids = await favoriteIds();
	if (on) {
		ids?.add(placeId(place));
	} else {
		ids?.delete(placeId(place));
	}
	return "saved";
}

// 가게 페이지나 지도를 열면 최근 본 가게로 남겨요. 실패해도 화면에는 알리지 않아요.
export async function recordView(place) {
	const member = await signedIn();
	if (!member) {
		return;
	}
	const { error } = await member.supabase
		.from("recent_places")
		.upsert({ ...placeRow(place), viewed_at: new Date().toISOString() }, { onConflict: "user_id,name,lat,lng" });
	if (error) {
		console.warn("최근 본 가게를 남기지 못했어요.", error);
	}
}

export async function listFavorites(supabase) {
	return listPlaces(supabase.from("favorite_places").select("name, address, lat, lng").order("created_at", { ascending: false }));
}

export async function listRecent(supabase) {
	return listPlaces(supabase.from("recent_places").select("name, address, lat, lng, viewed_at").order("viewed_at", { ascending: false }).limit(RECENT_LIMIT));
}

async function listPlaces(query) {
	const { data, error } = await query;
	if (error) {
		throw error;
	}
	return data;
}

function placeRow(place) {
	return { name: place.name, address: place.address || null, lat: place.lat, lng: place.lng };
}
