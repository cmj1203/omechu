import { loadMenus } from "./menus.js";
import { excludedMenus } from "./member.js";
import { rememberMenus } from "./nearby-menu-matching.js";
import { initNearby } from "./nearby.js";

const form = document.getElementById("filters");
const recommendButton = document.getElementById("recommend");
const storeSearch = document.getElementById("storeSearch");
const storeQuery = document.getElementById("storeQuery");
const menuSearch = document.getElementById("menuSearch");
const menuQuery = document.getElementById("menuQuery");
const result = document.getElementById("result");
const skippedDetails = document.getElementById("skippedMenus");
// 결과 상자는 메뉴를 불러온 뒤 보여요. 추천 전에는 그 자리에서 메뉴 이름이 천천히 흘러가고(슬롯머신, 사용자 10-30),
// '추천받기'를 누르면 빠르게 돌다 고른 메뉴에서 멈춰요. 움직임 줄이기를 켠 기기에서는 돌지 않아요.
const resultBox = result.closest(".result-box");
resultBox.hidden = true;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const SPIN_ROWS = 14;
const SPIN_MS = 1200;
// 다른 결과가 먼저 들어오면 돌던 슬롯이 멈춘 뒤 덮어쓰지 않게 세어요.
let spinId = 0;
const dataNote = document.getElementById("dataNote");
const nearby = initNearby(document.getElementById("nearby"));

// 간식·술은 나라 구분 없이 추천해서, 고르면 나라를 '전체'로 고정하고 다른 나라는 못 고르게 해요
lockCuisine();
form.addEventListener("change", () => {
	lockCuisine();
	// 가게 검색은 조건과 상관없이 찾아서, 조건을 바꿔도 다시 찾지 않아요.
	if (resultMode === "menu") {
		recommendMenu();
	} else if (resultMode === null && menus.length > 0) {
		showIdle();
	}
});
// 뒤로 가기로 돌아오면 브라우저가 고른 값을 나중에 되살려서, 그때 한 번 더 맞춰요
window.addEventListener("pageshow", lockCuisine);

const RECENT_LIMIT = 5;

let menus = [];
let current = null;
let resultMode = null;
let lastAllowed = [];
// '메뉴 빼기'로 뺀 메뉴는 이 화면을 연 동안만 빼요(사용자 10-30: 기기에 저장하지 않음).
// 늘 뺄 메뉴는 회원이 내 계정에 넣어 두고, 추천할 때 함께 빼요.
let recent = [];
let skipped = [];
let excluded = new Set();

try {
	const [loaded, memberExcluded] = await Promise.all([loadMenus(), excludedMenus()]);
	menus = loaded.menus;
	rememberMenus(menus);
	excluded = memberExcluded ?? new Set();
	if (loaded.usedFallback) {
		dataNote.textContent = "지금은 기본 메뉴 목록으로 추천하고 있어요.";
		dataNote.hidden = false;
	}
	recommendButton.disabled = false;
	recommendButton.textContent = "추천받기";
	storeQuery.disabled = false;
	menuQuery.disabled = false;
	showIdle();
	openDecided(new URLSearchParams(location.search));
} catch (error) {
	console.error(error);
	recommendButton.textContent = "메뉴를 불러오지 못했어요";
	showMessage("잠시 후 새로고침해 주세요.");
}

form.addEventListener("submit", (event) => {
	event.preventDefault();
	// '메뉴 빼기'·다시 넣기는 requestSubmit()으로 와서 단추가 없어요. 그때는 돌지 않고 바로 바꿔요.
	recommendMenu({ spin: event.submitter === recommendButton });
});

storeSearch.addEventListener("submit", searchStores);
menuSearch.addEventListener("submit", searchMenus);

// 같이 정하기에서 확정한 메뉴·모일 곳으로 왔으면(index.html?menu=…&place=…&lat=…&lng=…) 그 메뉴를 그곳 근처에서 바로 찾아요.
// 메뉴 목록에 없는 이름(직접 적은 후보)은 메뉴 검색과 같이 찾아요.
function openDecided(params) {
	const name = params.get("menu")?.trim();
	if (!name) {
		return;
	}
	const lat = Number(params.get("lat"));
	const lng = Number(params.get("lng"));
	const label = params.get("place")?.trim();
	if (label && Number.isFinite(lat) && Number.isFinite(lng) && params.get("lat") && params.get("lng")) {
		nearby.setOrigin({ label, lat, lng });
	}
	const menu = menus.find((candidate) => candidate.name === name);
	if (!menu) {
		menuQuery.value = name;
		menuSearch.requestSubmit();
		return;
	}
	resultMode = "menu";
	current = menu;
	lastAllowed = [menu];
	showMenu(menu);
	nearby.show(menu, [menu]);
	recommendButton.textContent = "다시 추천받기";
}

function recommendMenu({ spin = false } = {}) {
	resultMode = "menu";
	const allowed = allowedMenus();
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
	if (spin && !reduceMotion.matches) {
		spinTo(current, allowed);
	} else {
		showMenu(current);
	}
	nearby.show(current, allowed);
	recommendButton.textContent = "다시 추천받기";
}

// 추천 전: 지금 조건의 메뉴(없으면 전체)를 섞어 천천히 흘려요. 같은 줄을 두 번 이어 붙여 끊김 없이 돌아요.
function showIdle() {
	const pool = candidateMenus().filter((menu) => !excluded.has(menu.name));
	const names = shuffle((pool.length > 0 ? pool : menus).map((menu) => menu.name)).slice(0, 12);
	const box = slot([...names, ...names]);
	box.classList.add("is-idle");
	box.style.setProperty("--slot-count", names.length);
	show(paragraph("menu-label", "오늘의 메뉴"), box);
}

// 고른 메뉴가 가운데 줄에 올 때까지 빠르게 올려 보내고, 멈추면 평소 결과로 바꿔요.
function spinTo(menu, pool) {
	const pick = () => pool[Math.floor(Math.random() * pool.length)].name;
	const before = Array.from({ length: SPIN_ROWS }, pick);
	const box = slot([...before, menu.name, pick()]);
	show(paragraph("menu-label", "오늘의 메뉴"), box);
	const id = spinId;
	const reel = box.firstElementChild;
	const row = reel.firstElementChild.offsetHeight;
	// 창은 세 줄이라, 고른 메뉴(before.length 번째)가 가운데 오려면 그 한 줄 위까지 올려요.
	const animation = reel.animate(
		[{ transform: "translateY(0)" }, { transform: `translateY(${-(before.length - 1) * row}px)` }],
		{ duration: SPIN_MS, easing: "cubic-bezier(0.2, 0.7, 0.25, 1)", fill: "forwards" },
	);
	animation.onfinish = () => {
		if (id === spinId) {
			showMenu(menu);
		}
	};
}

function slot(names) {
	const box = document.createElement("div");
	box.className = "slot";
	box.setAttribute("aria-hidden", "true");
	const reel = document.createElement("div");
	reel.className = "slot-reel";
	reel.append(...names.map((name) => paragraph("slot-item", name)));
	box.append(reel);
	return box;
}

function shuffle(items) {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i -= 1) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
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
	show(paragraph("menu-label", "가게 검색"), paragraph("menu-tags", query));
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
	show(paragraph("menu-label", "메뉴 검색"), paragraph("menu-tags", matched.map((menu) => menu.name).join(", ")));
	nearby.showSearch(query, matched);
}

// 조건에 맞고 빼지 않은 메뉴들. 없으면 안내를 보여 주고 null 을 돌려줘요.
function allowedMenus() {
	const candidates = candidateMenus();
	if (candidates.length === 0) {
		current = null;
		nearby.hide();
		showMessage("조건에 맞는 메뉴가 없어요. 조건을 바꿔 보세요.");
		return null;
	}
	const allowed = candidates.filter((menu) => !skipped.includes(menu.name) && !excluded.has(menu.name));
	if (allowed.length === 0) {
		current = null;
		nearby.hide();
		showMessage("이 조건의 메뉴를 모두 뺐어요.", excludedNote());
		return null;
	}
	return allowed;
}

// 종류·나라 조건에 맞는 메뉴들.
function candidateMenus() {
	const filters = Object.fromEntries(new FormData(form));
	return menus.filter((menu) =>
		(filters.kind === "전체" || menu.kinds.includes(filters.kind))
		&& (filters.cuisine === "전체" || menu.cuisine === filters.cuisine));
}

function lockCuisine() {
	const kind = form.elements.kind.value;
	const locked = kind === "간식" || kind === "술";
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
	show(
		paragraph("menu-label", "오늘의 메뉴"),
		paragraph("menu-name", menu.name),
		paragraph("menu-tags", [menu.kinds.join("·"), menu.cuisine].join(" | ")),
		menuActions(menu),
	);
}

function showMessage(text, ...extra) {
	show(paragraph("placeholder", text), ...extra);
}

function show(...nodes) {
	spinId += 1;
	resultBox.hidden = false;
	result.replaceChildren(...nodes);
}

function menuActions(menu) {
	const actions = document.createElement("div");
	actions.className = "menu-actions";
	actions.append(textButton("메뉴 빼기", () => {
		skipped = [...skipped, menu.name];
		renderSkipped();
		form.requestSubmit();
	}));
	actions.append(pollLink(menu));
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
	const menusParam = [menu.name, ...others].join(",");
	link.href = "vote.html?" + new URLSearchParams({ menus: menusParam });
	// 위치 칸은 메뉴를 보여 준 뒤에 채워져서, 누르는 순간의 위치를 '모일 곳'으로 넘겨요.
	link.addEventListener("click", () => {
		const place = document.getElementById("nearbyPlace").value.trim();
		const known = nearby.knownOrigin();
		link.href = "vote.html?" + new URLSearchParams({
			menus: menusParam,
			...(place ? { place } : {}),
			...(known ? { lat: known.lat, lng: known.lng } : {}),
		});
	});
	link.textContent = "친구랑 같이 정하기";
	return link;
}

function renderSkipped() {
	skippedDetails.hidden = skipped.length === 0;
	if (skipped.length === 0) {
		skippedDetails.open = false;
	}
	skippedDetails.querySelector("summary").textContent = "뺀 메뉴 전체 보기 (" + skipped.length + ")";
	skippedDetails.querySelector("ul").replaceChildren(...skipped.map((name, index) => {
		const item = document.createElement("li");
		const label = document.createElement("span");
		label.className = "skipped-menu-name";
		label.textContent = name;
		const restore = document.createElement("button");
		restore.type = "button";
		restore.className = "skipped-restore";
		restore.setAttribute("aria-label", name + " 다시 넣기");
		restore.addEventListener("click", () => {
			skipped = skipped.filter((other) => other !== name);
			renderSkipped();
			if (current === null && resultMode === "menu") {
				form.requestSubmit();
			}
			const buttons = skippedDetails.querySelectorAll("button");
			(buttons[Math.min(index, buttons.length - 1)] ?? result.querySelector(".menu-actions button") ?? recommendButton).focus();
		});
		item.append(label, restore);
		return item;
	}));
}

function textButton(label, onClick) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "text-button";
	button.textContent = label;
	button.addEventListener("click", onClick);
	return button;
}

// 내 계정에 넣어 둔 기본 제외 메뉴 때문에 남은 메뉴가 없을 때, 어디서 바꾸는지 알려 줘요.
function excludedNote() {
	const note = document.createElement("p");
	note.className = "skipped-note";
	if (excluded.size === 0) {
		return note;
	}
	const link = document.createElement("a");
	link.className = "text-button";
	link.href = "account.html";
	link.textContent = "내 계정에서 바꾸기";
	note.append("기본으로 뺀 메뉴 " + excluded.size + "개", link);
	return note;
}

function paragraph(className, text) {
	const element = document.createElement("p");
	element.className = className;
	element.textContent = text;
	return element;
}
