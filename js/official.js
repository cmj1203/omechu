import { getSupabase } from "./supabase.js";
import { addressOf, currentPosition, geocode } from "./nearby-location.js";
import { walkMinutes } from "./nearby-database.js";
import { placeNameLink } from "./place-page.js";
import { initPlacePicker } from "./place-picker.js";

const DEFAULT_RADIUS_METERS = 1500;
const WIDER_RADIUS_METERS = 3000;
const QUERY_TIMEOUT_MS = 8000;
const SOURCE_FIELDS = "name,address,category,lat,lng,visits,departments,avg_per_person,lunch_visits,dinner_visits,last_visit,agencies";

const form = document.getElementById("officialSearch");
const placeInput = document.getElementById("officialPlace");
const currentButton = document.getElementById("officialCurrentButton");
const resetButton = document.getElementById("officialReset");
const listTitle = document.getElementById("officialListTitle");
const status = document.getElementById("officialStatus");
const list = document.getElementById("officialList");
const orderGroup = document.getElementById("officialOrder");
const ORDER_TITLES = {
	visits: "많이 간 곳 TOP 30",
	lunch_visits: "점심에 많이 간 곳 TOP 30",
	dinner_visits: "저녁에 많이 간 곳 TOP 30",
};
let requestId = 0;
let lastOrigin = null;
let originLookup = null;
let searching = false;
let picker = null;

// 위치 칸은 메뉴 추천과 같아요: 칸을 누르면 카카오 장소 검색 창이 열리고, 고르면 바로 그곳 근처를 찾아요.
// 카카오를 못 불러오면 칸에 직접 적고 Enter 로 찾아요. 칸 안 오른쪽 단추는 현재 위치로 찾아요.
form.addEventListener("submit", (event) => {
	event.preventDefault();
	searchFromInput();
});
placeInput.addEventListener("click", () => {
	if (placeInput.readOnly) {
		searchFromInput();
	}
});
currentButton.addEventListener("click", () => {
	const before = placeInput.value;
	searchNearby(currentPosition(), "현재 위치를 확인하고 있어요.", (origin) => showAddress(origin, before));
});
resetButton.addEventListener("click", loadTopPicks);
form.addEventListener("change", (event) => {
	if (event.target.name === "price") {
		reload();
	}
});
orderGroup.addEventListener("change", loadTopPicks);
orderGroup.querySelector('input[value="' + defaultOrder() + '"]').checked = true;

await loadTopPicks();

async function loadTopPicks() {
	const id = ++requestId;
	const order = selectedOrder();
	lastOrigin = null;
	originLookup = null;
	setLoading("맛집 기록을 불러오고 있어요.", false);
	listTitle.textContent = ORDER_TITLES[order];
	orderGroup.hidden = false;
	resetButton.hidden = true;
	try {
		const supabase = await requiredSupabase();
		let query = supabase.from("official_picks").select(SOURCE_FIELDS);
		if (maxPrice()) {
			query = query.lte("avg_per_person", maxPrice());
		}
		const { data, error } = await query
			.order(order, { ascending: false })
			.order("visits", { ascending: false })
			.limit(30)
			.abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
		if (error) {
			throw error;
		}
		if (id === requestId) {
			renderPicks(data ?? [], null);
		}
	} catch (error) {
		if (id === requestId) {
			console.error(error);
			showStatus("맛집 기록을 불러오지 못했어요. 잠시 후 새로고침해 주세요.", "error");
		}
	}
}

// 위치 칸을 눌렀거나 Enter 를 쳤을 때. 장소 검색 창이 안 되면(카카오 오류) 칸에 적은 말로 찾아요.
function searchFromInput() {
	if (searching) {
		return;
	}
	if (placeInput.readOnly) {
		choosePlace();
		return;
	}
	const place = placeInput.value.trim();
	if (!place) {
		showStatus("동네나 역 이름을 입력해 주세요.", "error");
		placeInput.focus();
		return;
	}
	searchNearby(geocode(place), place + " 근처를 찾고 있어요.");
}

// 카카오 장소 검색 창에서 고른 곳 근처를 찾아요. 카카오를 못 불러오면 위치 칸에 직접 적는 방식으로 돌아가요.
async function choosePlace() {
	picker ??= initPlacePicker(document.getElementById("placePicker"));
	const chosen = await picker.open(placeInput.value.trim());
	if (chosen) {
		placeInput.value = chosen.label;
		searchNearby(Promise.resolve(chosen), chosen.label + " 근처를 찾고 있어요.");
	} else if (picker.failed) {
		placeInput.readOnly = false;
		placeInput.focus();
	}
}

// lookup 은 찾을 곳({ label, lat, lng })을 돌려줘요. onFound 는 찾을 곳을 알아낸 뒤에 불러요.
async function searchNearby(lookup, message, onFound = null) {
	const id = ++requestId;
	setLoading(message, true);
	lastOrigin = null;
	originLookup = lookup;
	try {
		const origin = await lookup;
		if (id !== requestId) {
			return;
		}
		onFound?.(origin);
		lastOrigin = origin;
		await showNearby(origin, id);
	} catch (error) {
		// 위치를 못 찾았으면 그 위치를 버려서, 가격을 바꾸면 TOP 목록으로 돌아가요.
		if (originLookup === lookup && !lastOrigin) {
			originLookup = null;
		}
		showSearchError(id, error);
	} finally {
		unlockSearch(id);
	}
}

// 현재 위치로 찾으면 그 주소를 위치 칸에 넣어 둬요. 주소를 기다리지 않고 먼저 찾고, 그사이 칸을 바꿨으면 덮어쓰지 않아요.
async function showAddress(origin, before) {
	const address = await addressOf(origin);
	if (address && placeInput.value === before) {
		placeInput.value = address;
	}
}

// 가격 조건을 바꾸면 지금 보고 있는 목록(TOP 또는 마지막으로 찾은 곳 근처)을 다시 불러와요.
async function reload() {
	if (!originLookup) {
		await loadTopPicks();
		return;
	}
	const id = ++requestId;
	setLoading((lastOrigin?.label || placeInput.value.trim() || "현재 위치") + " 근처를 다시 찾고 있어요.", true);
	try {
		const origin = await originLookup;
		if (id !== requestId) {
			return;
		}
		lastOrigin = origin;
		await showNearby(origin, id);
	} catch (error) {
		showSearchError(id, error);
	} finally {
		unlockSearch(id);
	}
}

async function showNearby(origin, id) {
	let picks = await loadNearby(origin, DEFAULT_RADIUS_METERS);
	if (id !== requestId) {
		return;
	}
	let widened = false;
	if (picks.length === 0) {
		picks = await loadNearby(origin, WIDER_RADIUS_METERS);
		if (id !== requestId) {
			return;
		}
		widened = picks.length > 0;
	}
	lastOrigin = origin;
	listTitle.textContent = origin.label + " 근처";
	orderGroup.hidden = true;
	resetButton.hidden = false;
	renderPicks(picks, origin, widened);
}

function showSearchError(id, error) {
	if (id === requestId) {
		console.error(error);
		list.replaceChildren();
		showStatus(error.message || "근처 맛집을 찾지 못했어요. 잠시 후 다시 눌러 주세요.", "error");
		resetButton.hidden = false;
	}
}

function unlockSearch(id) {
	if (id === requestId) {
		searching = false;
		currentButton.disabled = false;
	}
}

function maxPrice() {
	return Number(form.elements.price.value) || 0;
}

function selectedOrder() {
	return orderGroup.querySelector("input:checked").value;
}

// 처음 순서는 지금 시각에 맞춰요: 오전 10시~오후 3시는 점심, 오후 4시~밤 11시는 저녁, 그 밖에는 전체 방문 순.
function defaultOrder(hour = new Date().getHours()) {
	if (hour >= 10 && hour < 15) {
		return "lunch_visits";
	}
	if (hour >= 16 && hour < 23) {
		return "dinner_visits";
	}
	return "visits";
}

async function loadNearby(origin, radius) {
	const supabase = await requiredSupabase();
	const { data, error } = await supabase
		.rpc("official_picks_near", {
			p_lat: origin.lat,
			p_lng: origin.lng,
			p_radius: radius,
			p_max_price: maxPrice() || null,
		})
		.abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
	if (error) {
		throw error;
	}
	return (data ?? []).slice(0, 30);
}

async function requiredSupabase() {
	const supabase = await getSupabase();
	if (!supabase) {
		throw new Error("맛집 데이터에 연결하지 못했어요. 잠시 후 다시 눌러 주세요.");
	}
	return supabase;
}

function renderPicks(picks, origin, widened = false) {
	list.replaceChildren();
	if (picks.length === 0) {
		const message = maxPrice()
			? "이 가격 안에서 기록된 곳이 없어요. 가격 조건을 넓혀 보세요."
			: origin
				? "이 근처에는 기록된 곳이 없어요. 서울시청·은평구·서대문구·세종청사 근처에 많아요."
				: "데이터를 준비하고 있어요.";
		showStatus(message, "empty");
		return;
	}
	const fragment = document.createDocumentFragment();
	picks.forEach((pick, index) => fragment.append(pickItem(pick, index + 1, origin)));
	list.append(fragment);
	const note = widened
		? "1.5km 안에는 없어서 3km까지 넓혀 찾았어요. 가까운 순으로 " + picks.length + "곳을 보여 드려요."
		: "";
	showStatus(note, widened ? "note" : "ready");
}

function pickItem(pick, rank, origin) {
	const item = document.createElement("li");
	item.className = "official-pick";

	const rankElement = document.createElement("span");
	rankElement.className = "official-rank";
	rankElement.textContent = rank;

	const content = document.createElement("div");
	content.className = "official-pick-content";

	const heading = document.createElement("div");
	heading.className = "official-pick-heading";
	const name = document.createElement("h3");
	name.append(placeNameLink(pick));
	heading.append(name);
	if (pick.category) {
		heading.append(chip(pick.category, "official-category"));
	}

	const address = paragraph("official-address", pick.address || "주소 정보가 없어요.");
	const facts = document.createElement("div");
	facts.className = "official-facts";
	facts.append(chip("방문 " + number(pick.visits) + "번 · " + number(pick.departments) + "개 부서"));
	if (pick.avg_per_person != null) {
		facts.append(chip("1인 약 " + won(pick.avg_per_person)));
	}
	const meal = mainMeal(pick);
	if (meal) {
		facts.append(chip(meal));
	}
	if (pick.last_visit) {
		facts.append(chip("최근 " + pick.last_visit));
	}
	if (pick.agencies) {
		facts.append(chip(pick.agencies));
	}
	if (origin && Number.isFinite(Number(pick.distance))) {
		const distance = Math.round(Number(pick.distance));
		facts.prepend(chip(formatDistance(distance) + " · 도보 약 " + walkMinutes(distance) + "분", "official-distance"));
	}

	const links = document.createElement("div");
	links.className = "official-links";
	links.append(
		link("카카오맵 길찾기\u00a0↗", kakaoRouteUrl(origin, pick)),
		link("지도에서 보기\u00a0↗", kakaoMapUrl(pick)),
	);

	content.append(heading, address, facts, links);
	item.append(rankElement, content);
	return item;
}

function setLoading(message, busy) {
	list.replaceChildren();
	showStatus(message, "loading");
	searching = busy;
	currentButton.disabled = busy;
}

function showStatus(message, state) {
	status.textContent = message;
	status.dataset.state = state;
	status.hidden = !message;
}

function mainMeal(pick) {
	const lunch = Number(pick.lunch_visits) || 0;
	const dinner = Number(pick.dinner_visits) || 0;
	if (lunch === dinner) {
		return "";
	}
	return lunch > dinner ? "주로 점심" : "주로 저녁";
}

function chip(text, className = "") {
	const element = document.createElement("span");
	element.className = "official-chip" + (className ? " " + className : "");
	element.textContent = text;
	return element;
}

function paragraph(className, text) {
	const element = document.createElement("p");
	element.className = className;
	element.textContent = text;
	return element;
}

function link(text, href) {
	const anchor = document.createElement("a");
	anchor.className = "official-map-link";
	anchor.href = href;
	anchor.target = "_blank";
	anchor.rel = "noopener";
	anchor.textContent = text;
	return anchor;
}

function kakaoMapUrl(pick) {
	return "https://map.kakao.com/link/map/" + kakaoLabel(pick.name) + "," + pick.lat + "," + pick.lng;
}

function kakaoRouteUrl(origin, pick) {
	if (!origin) {
		return "https://map.kakao.com/link/to/" + kakaoLabel(pick.name) + "," + pick.lat + "," + pick.lng;
	}
	return "https://map.kakao.com/link/from/" + kakaoLabel(origin.label) + "," + origin.lat + "," + origin.lng
		+ "/to/" + kakaoLabel(pick.name) + "," + pick.lat + "," + pick.lng;
}

function kakaoLabel(text) {
	return encodeURIComponent(text.replace(/,/g, " "));
}

function number(value) {
	return new Intl.NumberFormat("ko-KR").format(Number(value) || 0);
}

function won(value) {
	return number(Math.round(Number(value) / 1000) * 1000) + "원";
}

function formatDistance(meters) {
	return meters < 1000 ? meters + "m" : (meters / 1000).toFixed(1) + "km";
}
