import { loadMenus } from "./menus.js";
import { initNearby } from "./nearby.js";

const form = document.getElementById("filters");
const recommendButton = document.getElementById("recommend");
const result = document.getElementById("result");
const dataNote = document.getElementById("dataNote");
const nearby = initNearby(document.getElementById("nearby"));

let menus = [];
let current = null;

try {
	const loaded = await loadMenus();
	menus = loaded.menus;
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
	const others = candidates.filter((menu) => menu.name !== current?.name);
	const pool = others.length > 0 ? others : candidates;
	current = pool[Math.floor(Math.random() * pool.length)];
	showMenu(current);
	nearby.show(current, candidates);
	recommendButton.textContent = "다시 추천받기";
});

function showMenu(menu) {
	result.replaceChildren(
		paragraph("menu-label", "오늘의 메뉴"),
		paragraph("menu-name", menu.name),
		paragraph("menu-tags", [menu.kind, menu.cuisine].join(" | ")),
	);
}

function showMessage(text) {
	result.replaceChildren(paragraph("placeholder", text));
}

function paragraph(className, text) {
	const element = document.createElement("p");
	element.className = className;
	element.textContent = text;
	return element;
}
