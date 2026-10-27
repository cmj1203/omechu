// 화면 테스트 공통 준비: 사이트 파일은 저장소에서 바로 내보내고, 바깥 서비스(Supabase·구글 지도·카카오 지도)는 가짜로 바꿔요.
// 바깥으로 나가는 다른 요청은 모두 막아요(Nominatim·Overpass·글꼴 등). 그래서 인터넷 없이 돌아요.
import { test as base, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
export const ORIGIN = { latitude: 37.5665, longitude: 126.978 };

// 가짜 가게: [이름 앞말, 북쪽으로 몇 m, 구글 정보(없으면 null)]. 이름은 '앞말 + 찾는 메뉴 검색어'가 돼요.
// 평점 우선: 인기(오메추 4.66) > 조금(리뷰 12개 5.0 → 4.11) > 가까운(구글 없음 → 4.0) > 둘째 > 셋째, 닫힌·폐업은 빼요.
export const PLACES = [
	["가까운", 100, null],
	["닫힌", 120, { rating: 4.9, reviews: 2000, open: false }],
	["폐업", 130, { rating: 4.8, reviews: 900, status: "CLOSED_PERMANENTLY" }],
	["조금", 150, { rating: 5.0, reviews: 12, open: true }],
	["둘째", 200, { rating: 3.5, reviews: 300, open: true }],
	["셋째", 300, { rating: 3.4, reviews: 250 }],
	["인기", 700, { rating: 4.7, reviews: 1500, open: true }],
];

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

// Supabase 클라이언트 흉내. 표와 로그인은 localStorage 에 두어서 화면을 옮겨도 이어져요.
// 실제 권한(RLS)은 tests/db 의 SQL 테스트가 보고, 여기서는 화면이 부르는 방식만 맞춰요.
const fakeSupabase = (places) => `
const PLACES = ${JSON.stringify(places)};
const OWN = ["favorite_places", "recent_places"];
const load = () => JSON.parse(localStorage.getItem("__fakedb") || '{"users":[],"admins":[]}');
const save = (db) => localStorage.setItem("__fakedb", JSON.stringify(db));
const session = () => JSON.parse(localStorage.getItem("__fakesession") || "null");
const same = (a, b) => a.name === b.name && a.lat === b.lat && a.lng === b.lng;
class Query {
	constructor(table) { this.table = table; this.filters = []; this.op = "select"; }
	select() { return this; }
	eq(key, value) { this.filters.push([key, value]); return this; }
	order(key, options) { this.sort = [key, options?.ascending !== false]; return this; }
	limit(n) { this.max = n; return this; }
	maybeSingle() { this.single = true; return this; }
	abortSignal() { return this; }
	insert(row) { this.op = "insert"; this.row = row; return this; }
	upsert(row) { this.op = "upsert"; this.row = row; return this; }
	delete() { this.op = "delete"; return this; }
	then(resolve, reject) { return Promise.resolve().then(() => this.run()).then(resolve, reject); }
	run() {
		const db = load();
		const uid = session()?.user.id;
		const own = OWN.includes(this.table);
		if (own && !uid) return { data: null, error: { code: "42501", message: "permission denied" } };
		const rows = (db[this.table] ??= []);
		const mine = (r) => !own || r.user_id === uid;
		const match = (r) => mine(r) && this.filters.every(([k, v]) => r[k] === v);
		if (this.op === "insert" || this.op === "upsert") {
			const row = { created_at: new Date().toISOString(), ...this.row, ...(own ? { user_id: uid } : {}) };
			const index = rows.findIndex((r) => mine(r) && same(r, row));
			if (index >= 0 && this.op === "insert") return { data: null, error: { code: "23505", message: "duplicate" } };
			if (index >= 0) rows.splice(index, 1);
			rows.push(row);
			save(db);
			return { data: null, error: null };
		}
		if (this.op === "delete") {
			db[this.table] = rows.filter((r) => !match(r));
			save(db);
			return { data: null, error: null };
		}
		let out = rows.filter(match);
		if (this.sort) {
			const [key, asc] = this.sort;
			out = [...out].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (asc ? 1 : -1));
		}
		if (this.max) out = out.slice(0, this.max);
		return { data: this.single ? out[0] ?? null : out, error: null };
	}
}
export function createClient() {
	return {
		from: (table) => new Query(table),
		auth: {
			async getSession() { return { data: { session: session() } }; },
			onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
			async signInWithPassword({ email, password }) {
				const user = load().users.find((u) => u.email === email && u.password === password);
				if (!user) return { data: {}, error: { code: "invalid_credentials", message: "Invalid login credentials" } };
				const s = { user: { id: user.id, email } };
				localStorage.setItem("__fakesession", JSON.stringify(s));
				return { data: s, error: null };
			},
			async signUp({ email, password }) {
				const db = load();
				if (db.users.some((u) => u.email === email)) return { data: {}, error: { code: "user_already_exists", message: "User already registered" } };
				const user = { id: crypto.randomUUID(), email, password };
				db.users.push(user);
				save(db);
				const s = { user: { id: user.id, email } };
				localStorage.setItem("__fakesession", JSON.stringify(s));
				return { data: { user: s.user, session: s }, error: null };
			},
			async signOut() { localStorage.removeItem("__fakesession"); return { error: null }; },
		},
		rpc(name, args) {
			let result = { data: [], error: null };
			if (name === "nearby_places") {
				const term = (args.p_terms || [])[0] || "식당";
				result.data = PLACES.map(([prefix, meters]) => ({
					name: prefix + term, amenity: (args.p_amenities || ["restaurant"])[0], shop: null,
					lat: Number((args.p_lat + meters / 111000).toFixed(6)), lng: args.p_lng, distance: meters,
					phone: "02-123-4567", address: "서울 중구 세종대로 110", matched: true, official_visits: 0, category: null,
				}));
			}
			if (name === "delete_my_account") {
				const uid = session()?.user.id;
				const db = load();
				db.users = db.users.filter((u) => u.id !== uid);
				for (const table of OWN) db[table] = (db[table] || []).filter((r) => r.user_id !== uid);
				save(db);
			}
			const promise = Promise.resolve(result);
			promise.abortSignal = () => promise;
			return promise;
		},
	};
}`;

// 구글 지도 JavaScript API 흉내: Place.searchByText 만. 같은 이름 앞말의 PLACES 정보를 돌려줘요.
const fakeGoogle = (places) => `(() => {
	const PLACES = ${JSON.stringify(places)};
	window.__googleCalls = 0;
	window.google = { maps: { importLibrary: async () => ({ Place: { searchByText: async (q) => {
		window.__googleCalls += 1;
		const spec = PLACES.find(([prefix]) => q.textQuery.startsWith(prefix));
		const info = spec?.[2];
		if (!info) return { places: [] };
		return { places: [{
			displayName: q.textQuery,
			location: { lat: () => q.locationBias.center.lat, lng: () => q.locationBias.center.lng },
			rating: info.rating, userRatingCount: info.reviews,
			businessStatus: info.status ?? "OPERATIONAL",
			isOpen: async () => info.open,
		}] };
	} } }) } };
	const callback = new URL(document.currentScript.src).searchParams.get("callback");
	setTimeout(() => window[callback](), 0);
})();`;

// 카카오 지도 SDK 흉내: 장소 검색(강남역 하나), 좌표 → 주소, 지도 그리기는 아무것도 안 해요.
const fakeKakao = `(() => {
	function LatLng(y, x) { this.y = y; this.x = x; }
	window.kakao = { maps: {
		load: (callback) => callback(),
		LatLng,
		LatLngBounds: function () { this.extend = () => {}; },
		Map: function () { this.relayout = () => {}; this.setBounds = () => {}; },
		CustomOverlay: function () { this.setMap = () => {}; },
		services: {
			Status: { OK: "OK", ZERO_RESULT: "ZERO_RESULT" },
			SortBy: { DISTANCE: "distance" },
			Geocoder: function () {
				this.coord2Address = (x, y, callback) => setTimeout(() => callback([{ road_address: { address_name: "서울 중구 세종대로 110" } }], "OK"), 50);
			},
			Places: function () {
				this.keywordSearch = (query, callback) => setTimeout(() => callback([{
					place_name: "강남역 2호선", road_address_name: "서울 강남구 강남대로 396", address_name: "서울 강남구 역삼동 858",
					x: "127.0276", y: "37.4979", place_url: "http://place.map.kakao.com/1",
				}], "OK"), 50);
			},
		},
	} };
})();`;

export const test = base.extend({
	// googleKey: false 면 js/place-rating.js 의 키를 비운 채로 둬요(평점 기능 꺼짐).
	googleKey: [true, { option: true }],
	context: async ({ context, googleKey }, use) => {
		await context.route("**/*", (route) => {
			const url = new URL(route.request().url());
			if (url.hostname === "app.test") {
				const path = url.pathname === "/" ? "/index.html" : url.pathname;
				let body = readFileSync(join(ROOT, decodeURIComponent(path)));
				if (googleKey && path === "/js/place-rating.js") {
					body = body.toString().replace('const GOOGLE_MAPS_KEY = "";', 'const GOOGLE_MAPS_KEY = "TEST";');
				}
				return route.fulfill({ contentType: (TYPES[extname(path)] ?? "application/octet-stream") + "; charset=utf-8", body });
			}
			if (url.hostname === "cdn.jsdelivr.net" && url.pathname.includes("supabase-js")) {
				return route.fulfill({ contentType: "text/javascript; charset=utf-8", body: fakeSupabase(PLACES) });
			}
			if (url.hostname === "maps.googleapis.com") {
				return route.fulfill({ contentType: "text/javascript; charset=utf-8", body: fakeGoogle(PLACES) });
			}
			if (url.hostname === "dapi.kakao.com") {
				return route.fulfill({ contentType: "text/javascript; charset=utf-8", body: fakeKakao });
			}
			return route.abort();
		});
		// 무작위로 고르는 곳(가까운 3곳 중 하나 등)이 늘 첫째를 고르게 해서 결과를 정해 둬요.
		await context.addInitScript(() => {
			Math.random = () => 0;
		});
		await use(context);
	},
	page: async ({ page }, use) => {
		const problems = [];
		page.on("pageerror", (error) => problems.push("pageerror: " + error.message));
		page.on("console", (message) => {
			if (/Content Security Policy/i.test(message.text())) {
				problems.push("CSP: " + message.text());
			}
		});
		await use(page);
		expect(problems, "화면 오류·CSP 위반이 없어야 해요").toEqual([]);
	},
});

export { expect };

// 메뉴 추천을 받고 주변 식당 추천 결과가 나올 때까지 기다려요(위치 권한을 준 컨텍스트에서는 바로 찾아요).
export async function recommend(page) {
	await page.goto("/index.html");
	await page.locator("#recommend:not([disabled])").click();
	await expect(page.locator(".restaurant-card")).toBeVisible();
}
