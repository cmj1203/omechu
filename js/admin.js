import { AMENITIES_BY_KIND, BAKERY_SHOPS, hasSearchTerm, nameForMenu, searchTerms } from "./nearby-menu-matching.js";
import { getSupabase, SUPABASE_CONFIGURED } from "./supabase.js";

const notice = document.getElementById("adminNotice");
const loginForm = document.getElementById("loginForm");
const loginMessage = document.getElementById("loginMessage");
const manager = document.getElementById("manager");
const whoami = document.getElementById("whoami");
const menuForm = document.getElementById("menuForm");
const formTitle = document.getElementById("formTitle");
const saveButton = document.getElementById("saveBtn");
const cancelButton = document.getElementById("cancelEdit");
const formMessage = document.getElementById("formMessage");
const menuRows = document.getElementById("menuRows");
const menuCount = document.getElementById("menuCount");
const menuSearch = document.getElementById("menuSearch");
const termsPreview = document.getElementById("termsPreview");
const placeSearch = document.getElementById("placeSearch");
const placeResults = document.getElementById("placeResults");
const hiddenList = document.getElementById("hiddenList");
const hiddenCount = document.getElementById("hiddenCount");
const hiddenEmpty = document.getElementById("hiddenEmpty");
const hideMessage = document.getElementById("hideMessage");

// 검색어 미리보기는 가게가 가장 많은 강남역 2km 안을 기준으로 세요.
const PREVIEW_SPOT = { lat: 37.4979, lng: 127.0276, label: "강남역" };
// 식당 검색 함수(nearby_places)는 가까운 80곳까지만 돌려줘요.
const RPC_LIMIT = 80;
const PLACE_RESULT_LIMIT = 30;

let supabase = null;
let editingId = null;
let allMenus = [];
let hiddenIds = new Set();
let lastPlaces = [];
let previewTimer = null;
let previewId = 0;

if (!SUPABASE_CONFIGURED) {
	showNotice("아직 Supabase가 연결되지 않았어요. js/supabase.js 에 프로젝트 주소와 공개 키를 넣어 주세요.");
} else {
	try {
		supabase = await getSupabase();
		const { data } = await supabase.auth.getSession();
		if (data.session) {
			await openManager(data.session.user);
		} else {
			loginForm.hidden = false;
		}
	} catch (error) {
		showNotice("Supabase에 연결하지 못했어요: " + error.message);
	}
}

loginForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const { email, password } = Object.fromEntries(new FormData(loginForm));
	setMessage(loginMessage, "로그인 중…");
	const { data, error } = await supabase.auth.signInWithPassword({ email, password });
	if (error) {
		setMessage(loginMessage, "이메일이나 비밀번호가 맞지 않아요.", true);
		return;
	}
	setMessage(loginMessage, "");
	await openManager(data.user);
});

document.getElementById("logout").addEventListener("click", async () => {
	await supabase.auth.signOut();
	manager.hidden = true;
	resetForm();
	placeSearch.reset();
	lastPlaces = [];
	placeResults.replaceChildren();
	setMessage(hideMessage, "");
	loginForm.reset();
	loginForm.hidden = false;
});

menuForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const fields = new FormData(menuForm);
	const record = {
		name: fields.get("name").trim(),
		kind: fields.get("kind"),
		cuisine: fields.get("cuisine"),
		search_terms: commaList(fields.get("search_terms")),
		exclude_terms: commaList(fields.get("exclude_terms")),
	};
	if (!record.name) {
		setMessage(formMessage, "메뉴 이름을 적어 주세요.", true);
		return;
	}

	saveButton.disabled = true;
	const adding = editingId === null;
	const { error } = adding
		? await supabase.from("menus").insert(record)
		: await supabase.from("menus").update(record).eq("id", editingId);
	saveButton.disabled = false;
	if (error) {
		setMessage(formMessage, error.code === "23505" ? "이미 있는 메뉴 이름이에요." : "저장하지 못했어요: " + error.message, true);
		return;
	}
	resetForm();
	setMessage(formMessage, (adding ? "추가했어요: " : "수정했어요: ") + record.name);
	await refreshList();
});

cancelButton.addEventListener("click", () => {
	resetForm();
	setMessage(formMessage, "");
});

async function openManager(user) {
	const { data: adminRow, error } = await supabase
		.from("admins")
		.select("user_id")
		.eq("user_id", user.id)
		.maybeSingle();
	if (error || !adminRow) {
		await supabase.auth.signOut();
		loginForm.hidden = false;
		setMessage(loginMessage, "관리자 권한이 없는 계정이에요.", true);
		return;
	}
	loginForm.hidden = true;
	manager.hidden = false;
	whoami.textContent = user.email + "으로 로그인했어요";
	await Promise.all([refreshList(), refreshHidden()]);
}

async function refreshList() {
	const { data, error } = await supabase
		.from("menus")
		.select("id, name, kind, cuisine, search_terms, exclude_terms")
		.order("kind")
		.order("cuisine")
		.order("name");
	if (error) {
		menuCount.textContent = "";
		const row = document.createElement("tr");
		const cell = textCell("메뉴를 불러오지 못했어요: " + error.message);
		cell.colSpan = 6;
		row.append(cell);
		menuRows.replaceChildren(row);
		return;
	}
	allMenus = data;
	renderMenuRows();
}

function renderMenuRows() {
	const query = menuSearch.value.trim().toLowerCase();
	const shown = query
		? allMenus.filter((menu) => [menu.name, ...menu.search_terms].some((text) => text.toLowerCase().includes(query)))
		: allMenus;
	menuCount.textContent = "(" + (query ? shown.length + "/" : "") + allMenus.length + "개)";
	if (shown.length === 0) {
		const row = document.createElement("tr");
		const cell = textCell("찾는 메뉴가 없어요.", "empty");
		cell.colSpan = 6;
		row.append(cell);
		menuRows.replaceChildren(row);
		return;
	}
	menuRows.replaceChildren(...shown.map(menuRow));
}

function menuRow(menu) {
	const actions = document.createElement("td");
	actions.append(
		actionButton("수정", "small", () => startEdit(menu)),
		" ",
		actionButton("삭제", "small danger", () => removeMenu(menu)),
	);
	const row = document.createElement("tr");
	row.append(
		textCell(menu.name),
		textCell(menu.kind),
		textCell(menu.cuisine),
		textCell(menu.search_terms.join(", "), "terms"),
		textCell(menu.exclude_terms.join(", "), "terms"),
		actions,
	);
	return row;
}

function startEdit(menu) {
	editingId = menu.id;
	menuForm.elements.namedItem("name").value = menu.name;
	menuForm.elements.namedItem("kind").value = menu.kind;
	menuForm.elements.namedItem("cuisine").value = menu.cuisine;
	menuForm.elements.namedItem("search_terms").value = menu.search_terms.join(", ");
	menuForm.elements.namedItem("exclude_terms").value = menu.exclude_terms.join(", ");
	formTitle.textContent = "메뉴 수정: " + menu.name;
	saveButton.textContent = "저장";
	cancelButton.hidden = false;
	setMessage(formMessage, "");
	updatePreview();
	menuForm.scrollIntoView({ behavior: "smooth" });
}

function resetForm() {
	editingId = null;
	menuForm.reset();
	formTitle.textContent = "메뉴 추가";
	saveButton.textContent = "추가";
	cancelButton.hidden = true;
	clearTimeout(previewTimer);
	previewId += 1;
	termsPreview.textContent = "";
}

async function removeMenu(menu) {
	if (!confirm("'" + menu.name + "' 메뉴를 삭제할까요?")) {
		return;
	}
	const { error } = await supabase.from("menus").delete().eq("id", menu.id);
	if (error) {
		setMessage(formMessage, "삭제하지 못했어요: " + error.message, true);
		return;
	}
	if (editingId === menu.id) {
		resetForm();
	}
	setMessage(formMessage, "삭제했어요: " + menu.name);
	await refreshList();
}

menuSearch.addEventListener("input", renderMenuRows);

for (const field of ["name", "kind", "search_terms", "exclude_terms"]) {
	menuForm.elements.namedItem(field).addEventListener("input", () => {
		clearTimeout(previewTimer);
		previewTimer = setTimeout(updatePreview, 400);
	});
}

// 고치는 중인 검색어·제외어로 강남역 2km 안에서 가게가 몇 곳 잡히는지 보여 줘요. 추천 화면과 같은 방식으로 세요.
async function updatePreview() {
	const id = ++previewId;
	const fields = new FormData(menuForm);
	const draft = {
		name: fields.get("name").trim(),
		kind: fields.get("kind"),
		search_terms: commaList(fields.get("search_terms")),
		exclude_terms: commaList(fields.get("exclude_terms")),
	};
	if (!draft.name) {
		termsPreview.textContent = "";
		return;
	}
	termsPreview.textContent = PREVIEW_SPOT.label + " 2km 안에서 찾는 중…";
	const { data, error } = await supabase.rpc("nearby_places", {
		p_lat: PREVIEW_SPOT.lat,
		p_lng: PREVIEW_SPOT.lng,
		p_radius: 2000,
		p_terms: searchTerms(draft),
		p_amenities: AMENITIES_BY_KIND[draft.kind],
		p_shops: draft.kind === "간식" ? BAKERY_SHOPS : [],
		p_similar_amenities: [],
		p_similar_cuisine: null,
	});
	if (id !== previewId) {
		return;
	}
	if (error) {
		termsPreview.textContent = "미리보기를 하지 못했어요: " + error.message;
		return;
	}
	const found = data.filter((place) => place.matched);
	const hits = found.filter((place) => hasSearchTerm(nameForMenu(place, draft), draft));
	if (hits.length === 0) {
		termsPreview.textContent = found.length >= RPC_LIMIT
			? PREVIEW_SPOT.label + " 2km 안 가까운 " + RPC_LIMIT + "곳이 모두 제외어에 걸렸어요."
			: PREVIEW_SPOT.label + " 2km 안에 이 검색어로 잡히는 가게가 없어요.";
		return;
	}
	const count = found.length >= RPC_LIMIT ? hits.length + "곳 넘게" : hits.length + "곳";
	const names = hits.slice(0, 3).map((place) => place.name).join(", ") + (hits.length > 3 ? " 등" : "");
	const dropped = found.length - hits.length;
	termsPreview.textContent = PREVIEW_SPOT.label + " 2km 안 " + count + ": " + names + (dropped > 0 ? " (제외어로 " + dropped + "곳 빠짐)" : "");
}

placeSearch.addEventListener("submit", async (event) => {
	event.preventDefault();
	const query = new FormData(placeSearch).get("q").trim();
	if (!query) {
		return;
	}
	setMessage(hideMessage, "찾는 중…");
	const { data, error } = await supabase
		.from("places")
		.select("osm_id, name, address")
		.ilike("name", "%" + query.replace(/[%_\\]/g, "\\$&") + "%")
		.order("name")
		.limit(PLACE_RESULT_LIMIT);
	if (error) {
		setMessage(hideMessage, "가게를 찾지 못했어요: " + error.message, true);
		return;
	}
	lastPlaces = data;
	setMessage(hideMessage, data.length === 0
		? "그런 이름의 가게가 없어요."
		: data.length === PLACE_RESULT_LIMIT ? PLACE_RESULT_LIMIT + "곳까지만 보여 줘요. 이름을 더 길게 적으면 좁혀져요." : "");
	renderPlaces();
});

function renderPlaces() {
	placeResults.replaceChildren(...lastPlaces.map((place) => placeItem(place, hiddenIds.has(place.osm_id)
		? null
		: actionButton("숨기기", "small danger", () => hidePlace(place)))));
}

async function refreshHidden() {
	const { data, error } = await supabase
		.from("hidden_places")
		.select("osm_id, name, address")
		.order("hidden_at", { ascending: false });
	if (error) {
		setMessage(hideMessage, "숨긴 가게를 불러오지 못했어요: " + error.message, true);
		return;
	}
	hiddenIds = new Set(data.map((place) => place.osm_id));
	hiddenCount.textContent = "(" + data.length + "곳)";
	hiddenEmpty.hidden = data.length > 0;
	hiddenList.replaceChildren(...data.map((place) => placeItem(place, actionButton("다시 보이기", "small", () => unhidePlace(place)))));
	renderPlaces();
}

async function hidePlace(place) {
	const { error } = await supabase.from("hidden_places").insert({ osm_id: place.osm_id, name: place.name, address: place.address });
	if (error) {
		setMessage(hideMessage, "숨기지 못했어요: " + error.message, true);
		return;
	}
	setMessage(hideMessage, "숨겼어요: " + place.name);
	await refreshHidden();
}

async function unhidePlace(place) {
	const { error } = await supabase.from("hidden_places").delete().eq("osm_id", place.osm_id);
	if (error) {
		setMessage(hideMessage, "다시 보이게 하지 못했어요: " + error.message, true);
		return;
	}
	setMessage(hideMessage, "다시 보이게 했어요: " + place.name);
	await refreshHidden();
}

// 숨긴 가게(이미 숨김)에는 버튼 대신 '숨김'을 보여 줘요.
function placeItem(place, button) {
	const item = document.createElement("li");
	const text = document.createElement("div");
	text.append(textLine("place-name", place.name), textLine("place-address", place.address || "주소 정보 없음"));
	item.append(text, button ?? textLine("place-state", "숨김"));
	return item;
}

function textLine(className, text) {
	const line = document.createElement("p");
	line.className = className;
	line.textContent = text;
	return line;
}

function commaList(text) {
	return text.split(",").map((term) => term.trim()).filter(Boolean);
}

function textCell(text, className = "") {
	const cell = document.createElement("td");
	cell.className = className;
	cell.textContent = text;
	return cell;
}

function actionButton(label, className, onClick) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = className;
	button.textContent = label;
	button.addEventListener("click", onClick);
	return button;
}

function setMessage(element, text, isError = false) {
	element.textContent = text;
	element.classList.toggle("error", isError);
}

function showNotice(text) {
	notice.textContent = text;
	notice.hidden = false;
}
