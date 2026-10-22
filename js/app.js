import { loadMenus } from "./menus.js";
import { rememberMenus } from "./nearby-menu-matching.js";
import { initNearby } from "./nearby.js";

const form = document.getElementById("filters");
const recommendButton = document.getElementById("recommend");
const storeSearch = document.getElementById("storeSearch");
const storeQuery = document.getElementById("storeQuery");
const menuSearch = document.getElementById("menuSearch");
const menuQuery = document.getElementById("menuQuery");
const result = document.getElementById("result");
const dataNote = document.getElementById("dataNote");
const lockNote = document.getElementById("cuisineLockNote");
const nearby = initNearby(document.getElementById("nearby"));

// 간식·술은 나라 구분 없이 추천해서, 고르면 나라를 '전체'로 고정하고 다른 나라는 못 고르게 해요
lockCuisine();
form.addEventListener("change", () => {
	lockCuisine();
	// 가게 검색은 조건과 상관없이 찾아서, 조건을 바꿔도 다시 찾지 않아요.
	if (resultMode === "menu") {
		recommendMenu();
	}
});
// 뒤로 가기로 돌아오면 브라우저가 고른 값을 나중에 되살려서, 그때 한 번 더 맞춰요
window.addEventListener("pageshow", lockCuisine);

const RECENT_LIMIT = 5;
const SKIPPED_KEY = "omechu.skippedMenus";

let menus = [];
let current = null;
let resultMode = null;
let lastAllowed = [];
let recent = [];
let skipped = readSkipped();

try {
	const loaded = await loadMenus();
	menus = loaded.menus;
	rememberMenus(menus);
	skipped = skipped.filter((name) => menus.some((menu) => menu.name === name));
	if (loaded.usedFallback) {
		dataNote.textContent = "지금은 기본 메뉴 목록으로 추천하고 있어요.";
		dataNote.hidden = false;
	}
	recommendButton.disabled = false;
	recommendButton.textContent = "추천받기";
	storeQuery.disabled = false;
	menuQuery.disabled = false;
} catch (error) {
	console.error(error);
	recommendButton.textContent = "메뉴를 불러오지 못했어요";
	showMessage("잠시 후 새로고침해 주세요.");
}

form.addEventListener("submit", (event) => {
	event.preventDefault();
	recommendMenu();
});

storeSearch.addEventListener("submit", searchStores);
menuSearch.addEventListener("submit", searchMenus);

function recommendMenu() {
	resultMode = "menu";
	const allowed = allowedMenus(true);
	if (!allowed) {
		return;
	}
	// 최근에 나온 5개는 다시 안 나오게 골라요. 조건에 맞는 메뉴가 그보다 적으면 바로 전 메뉴만 피해요.
	let pool = allowed.filter((menu) => !recent.includes(menu.name));
	if (pool.length === 0) {
		pool = allowed.filter((menu) => menu.name !== current?.name);
	}
	if (pool.length === 0) {
		pool = allowed;
	}
	current = pool[Math.floor(Math.random() * pool.length)];
	recent = [current.name, ...recent.filter((name) => name !== current.name)].slice(0, RECENT_LIMIT);
	lastAllowed = allowed;
	showMenu(current);
	nearby.show(current, allowed);
	recommendButton.textContent = "다시 추천받기";
}

// 직접 친 말로 주변 가게를 찾아요. 메뉴 이름(또는 그 메뉴의 주력 검색어)이면 그 메뉴를 주력으로 파는 가게를,
// 아니면 이름에 그 말이 든 가게를 보여 줘요.
function searchStores(event) {
	event.preventDefault();
	const query = storeQuery.value.trim();
	if (!query) {
		storeQuery.focus();
		return;
	}
	resultMode = "search";
	current = null;
	// 키보드를 내리고 칸을 다시 작게 돌려 '다시 추천받기'가 보이게 해요.
	storeQuery.blur();
	const menu = menus.find((candidate) => candidate.name === query)
		?? menus.find((candidate) => (candidate.search_terms ?? []).includes(query) && !(candidate.broad_terms ?? []).includes(query));
	result.replaceChildren(paragraph("menu-label", "가게 검색"), paragraph("menu-tags", query));
	nearby.showSearch(query, menu ? [menu] : []);
}

// 친 말과 이름이 같은 메뉴, 없으면 이름에 그 말이 든 메뉴들('국수' → 잔치국수·비빔국수)을 파는 가게를
// 가게 검색과 같은 목록으로 보여 줘요. 띄어쓰기는 무시해요.
function searchMenus(event) {
	event.preventDefault();
	const query = menuQuery.value.trim();
	if (!query) {
		menuQuery.focus();
		return;
	}
	resultMode = "search";
	current = null;
	menuQuery.blur();
	const key = query.replace(/\s+/g, "");
	const exact = menus.find((menu) => menu.name.replace(/\s+/g, "") === key);
	const matched = exact ? [exact] : menus.filter((menu) => menu.name.replace(/\s+/g, "").includes(key));
	if (matched.length === 0) {
		nearby.hide();
		showMessage("'" + query + "' 메뉴가 없어요.");
		return;
	}
	result.replaceChildren(paragraph("menu-label", "메뉴 검색"), paragraph("menu-tags", matched.map((menu) => menu.name).join(", ")));
	nearby.showSearch(query, matched);
}

// 조건에 맞고 빼지 않은 메뉴들. 없으면 안내를 보여 주고 null 을 돌려줘요.
function allowedMenus(recommendAgain) {
	const filters = Object.fromEntries(new FormData(form));
	const candidates = menus.filter((menu) =>
		(filters.kind === "전체" || menu.kinds.includes(filters.kind))
		&& (filters.cuisine === "전체" || menu.cuisine === filters.cuisine));
	if (candidates.length === 0) {
		current = null;
		nearby.hide();
		showMessage("조건에 맞는 메뉴가 없어요. 조건을 바꿔 보세요.");
		return null;
	}
	const allowed = candidates.filter((menu) => !skipped.includes(menu.name));
	if (allowed.length === 0) {
		current = null;
		nearby.hide();
		showMessage("이 조건의 메뉴를 모두 뺐어요.", skippedNote(recommendAgain));
		return null;
	}
	return allowed;
}

function lockCuisine() {
	const kind = form.elements.kind.value;
	const locked = kind === "간식" || kind === "술";
	lockNote.hidden = !locked;
	for (const option of form.elements.cuisine) {
		if (option.value === "전체") {
			if (locked) {
				option.checked = true;
			}
		} else {
			option.disabled = locked;
		}
	}
}

function showMenu(menu) {
	result.replaceChildren(
		paragraph("menu-label", "오늘의 메뉴"),
		paragraph("menu-name", menu.name),
		paragraph("menu-tags", [menu.kinds.join("·"), menu.cuisine].join(" | ")),
		menuActions(menu),
	);
}

function showMessage(text, ...extra) {
	result.replaceChildren(paragraph("placeholder", text), ...extra);
}

function menuActions(menu) {
	const actions = document.createElement("div");
	actions.className = "menu-actions";
	actions.append(textButton("이 메뉴 빼기", () => {
		skipped = [...skipped, menu.name];
		saveSkipped();
		form.requestSubmit();
	}));
	actions.append(pollLink(menu));
	if (skipped.length > 0) {
		actions.append(skippedNote(false));
	}
	return actions;
}

// 지금 메뉴에 같은 조건의 다른 메뉴 2개를 더해 투표 화면(vote.html)으로 보내요. 후보는 투표 화면에서 바꿀 수 있어요.
function pollLink(menu) {
	const others = lastAllowed
		.filter((item) => item.name !== menu.name)
		.sort(() => Math.random() - 0.5)
		.slice(0, 2)
		.map((item) => item.name);
	const link = document.createElement("a");
	link.className = "text-button";
	link.href = "vote.html?menus=" + encodeURIComponent([menu.name, ...others].join(","));
	link.textContent = "친구랑 같이 정하기";
	return link;
}

// 뺀 메뉴는 이 기기에만 기억해요. '다시 넣기'를 누르면 모두 돌아와요.
function skippedNote(recommendAgain) {
	const note = document.createElement("p");
	note.className = "skipped-note";
	const names = skipped.slice(0, 3).join(", ") + (skipped.length > 3 ? " 외 " + (skipped.length - 3) + "개" : "");
	note.append("뺀 메뉴: " + names, textButton("다시 넣기", () => {
		skipped = [];
		saveSkipped();
		note.remove();
		if (recommendAgain) {
			form.requestSubmit();
		}
	}));
	return note;
}

function textButton(label, onClick) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "text-button";
	button.textContent = label;
	button.addEventListener("click", onClick);
	return button;
}

function readSkipped() {
	try {
		const saved = JSON.parse(localStorage.getItem(SKIPPED_KEY) ?? "[]");
		return Array.isArray(saved) ? saved.filter((name) => typeof name === "string") : [];
	} catch {
		return [];
	}
}

function saveSkipped() {
	try {
		localStorage.setItem(SKIPPED_KEY, JSON.stringify(skipped));
	} catch {
		// 저장이 막힌 브라우저(사생활 보호 모드 등)에서는 이 화면을 연 동안만 기억해요.
	}
}

function paragraph(className, text) {
	const element = document.createElement("p");
	element.className = className;
	element.textContent = text;
	return element;
}
