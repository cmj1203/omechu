import { currentPosition, geocode, locationAlreadyAllowed } from "./nearby-location.js";
import { footer, othersList, paragraph, restaurantCard, similarLabel } from "./nearby-renderer.js";
import { searchRestaurants } from "./nearby-restaurant-search.js";

export function initNearby(section) {
	const button = section.querySelector("#nearbyBtn");
	const placeInput = section.querySelector("#nearbyPlace");
	const result = section.querySelector("#nearbyResult");
	let menu = null;
	let filterMenus = [];
	let searchId = 0;

	button.addEventListener("click", findRestaurants);
	placeInput.addEventListener("keydown", (event) => {
		if (event.key === "Enter" && !button.disabled) {
			findRestaurants();
		}
	});

	return {
		async show(nextMenu, menusForFilters) {
			menu = nextMenu;
			filterMenus = menusForFilters;
			searchId += 1;
			button.disabled = false;
			button.textContent = idleLabel();
			result.replaceChildren();
			section.hidden = false;
			if (placeInput.value.trim() || await locationAlreadyAllowed()) {
				findRestaurants();
			}
		},
		hide() {
			searchId += 1;
			section.hidden = true;
		},
	};

	async function findRestaurants() {
		const id = ++searchId;
		const target = menu;
		const pool = filterMenus;
		const place = placeInput.value.trim();
		try {
			setBusy(place ? "위치 찾는 중…" : "위치 확인 중…");
			const origin = place ? await geocode(place) : await currentPosition();
			// 위치를 기다리는 사이 새 검색이 시작됐으면 여기서 멈춰요. 계속 가면 새 검색 버튼을 '식당 찾는 중…'으로 다시 잠가요.
			if (id !== searchId) {
				return;
			}
			setBusy("식당 찾는 중…");
			const found = await searchRestaurants(target, pool, origin);
			if (id === searchId) {
				render(target, origin, found);
			}
		} catch (error) {
			if (id === searchId) {
				showMessage(error.message, target, place);
			}
		} finally {
			if (id === searchId) {
				button.disabled = false;
				button.textContent = idleLabel();
			}
		}
	}

	function idleLabel() {
		return "주변 '" + menu.name + "' 식당 추천";
	}

	function setBusy(label) {
		button.disabled = true;
		button.textContent = label;
	}

	function render(target, origin, found) {
		if (!found.pick) {
			showMessage(origin.label + " 근처 2km 안에서 조건에 맞는 식당을 찾지 못했어요.", target, origin);
			return;
		}
		const nodes = [];
		if (found.mode === "filter") {
			nodes.push(paragraph("nearby-note", "'" + target.name + "' 파는 곳은 못 찾아서, 같은\u00a0조건의 '" + found.pick.menuName + "' 가게를 골랐어요."));
		} else if (found.mode === "similar") {
			nodes.push(paragraph("nearby-note", "조건에 맞는 가게를 못 찾아서, 근처 " + similarLabel(target) + "을 골랐어요."));
		}
		nodes.push(restaurantCard(found.pick, origin));
		if (found.others.length > 0) {
			nodes.push(othersList(found.others, found.mode === "similar" ? "다른 가까운 곳" : "조건에 맞는 다른 가까운 곳"));
		}
		nodes.push(footer(target, origin));
		result.replaceChildren(...nodes);
	}

	function showMessage(text, target, where) {
		result.replaceChildren(paragraph("nearby-message", text), footer(target, where));
	}
}
