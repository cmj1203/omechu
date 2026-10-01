import { loadMenus } from "./menus.js";
import { initNearby } from "./nearby.js";

const form = document.getElementById("filters");
const recommendButton = document.getElementById("recommend");
const result = document.getElementById("result");
const dataNote = document.getElementById("dataNote");
const lockNote = document.getElementById("cuisineLockNote");
const nearby = initNearby(document.getElementById("nearby"));

// 간식·술은 나라 구분 없이 추천해서, 고르면 나라를 '전체'로 고정하고 다른 나라는 못 고르게 해요
lockCuisine();
form.addEventListener("change", lockCuisine);
// 뒤로 가기로 돌아오면 브라우저가 고른 값을 나중에 되살려서, 그때 한 번 더 맞춰요
window.addEventListener("pageshow", lockCuisine);

const RECENT_LIMIT = 5;
const SKIPPED_KEY = "omechu.skippedMenus";

let menus = [];
let current = null;
let recent = [];
let skipped = readSkipped();

try {
	const loaded = await loadMenus();
	menus = loaded.menus;
	skipped = skipped.filter((name) => menus.some((menu) => menu.name === name));
	if (loaded.usedFallback) {
		dataNote.textContent = "지금은 기본 메뉴 목록으로 추천하고 있어요.";
		dataNote.hidden = false;
	}
	recommendButton.disabled = false;
	recommendButton.textContent = "추천받기";
} catch (error) {
	console.error(error);
	recommendButton.textContent = "메뉴를 불러오지 못했어요";
	showMessage("잠시 후 새로고침해 주세요.");
}

form.addEventListener("submit", (event) => {
	event.preventDefault();
	const filters = Object.fromEntries(new FormData(form));
	const candidates = menus.filter((menu) =>
		(filters.kind === "전체" || menu.kind === filters.kind)
		&& (filters.cuisine === "전체" || menu.cuisine === filters.cuisine));

	if (candidates.length === 0) {
		current = null;
		nearby.hide();
		showMessage("조건에 맞는 메뉴가 없어요. 조건을 바꿔 보세요.");
		return;
	}
	const allowed = candidates.filter((menu) => !skipped.includes(menu.name));
	if (allowed.length === 0) {
		current = null;
		nearby.hide();
		showMessage("이 조건의 메뉴를 모두 뺐어요.", skippedNote(true));
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
	showMenu(current);
	nearby.show(current, allowed);
	recommendButton.textContent = "다시 추천받기";
});

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
		paragraph("menu-tags", [menu.kind, menu.cuisine].join(" | ")),
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
	if (skipped.length > 0) {
		actions.append(skippedNote(false));
	}
	return actions;
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
