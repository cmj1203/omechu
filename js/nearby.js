import { currentPosition, geocode, locationAlreadyAllowed } from "./nearby-location.js";
import { footer, othersList, paragraph, restaurantCard, similarLabel } from "./nearby-renderer.js";
import { searchRestaurants, searchStores } from "./nearby-restaurant-search.js";
import { initPlacePicker } from "./place-picker.js";

let picker = null;

export function initNearby(section) {
	const button = section.querySelector("#nearbyBtn");
	const currentButton = section.querySelector("#nearbyCurrentBtn");
	const placeInput = section.querySelector("#nearbyPlace");
	const result = section.querySelector("#nearbyResult");
	let menu = null;
	let filterMenus = [];
	let listMode = false;
	let queryMenu = null;
	let searchId = 0;
	let pickedOrigin = null;
	let originLookup = null;
	picker ??= initPlacePicker(document.querySelector("#placePicker"));

	button.addEventListener("click", () => {
		if (placeInput.readOnly && !placeInput.value.trim()) {
			choosePlace();
			return;
		}
		findRestaurants(false);
	});
	currentButton.addEventListener("click", () => findRestaurants(true));
	placeInput.addEventListener("click", () => {
		if (placeInput.readOnly && !button.disabled) {
			choosePlace();
		}
	});
	// 위치 칸에 직접 적는 방식에서 글자를 바꾸면, 필터를 바꿀 때 새로 적은 곳으로 찾아요.
	placeInput.addEventListener("input", () => {
		originLookup = null;
	});
	placeInput.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" || button.disabled) {
			return;
		}
		if (placeInput.readOnly) {
			choosePlace();
		} else {
			findRestaurants(false);
		}
	});

	return {
		show(nextMenu, menusForFilters) {
			menu = nextMenu;
			filterMenus = menusForFilters;
			listMode = false;
			start();
		},
		// 직접 친 말로 찾은 가게를 가까운 순으로 보여 줘요. '구글 지도에서 더 찾기'도 그 말로 찾아요.
		showSearch(query, matchedMenu) {
			menu = { name: query };
			queryMenu = matchedMenu;
			filterMenus = [];
			listMode = true;
			start();
		},
		hide() {
			searchId += 1;
			section.hidden = true;
		},
	};

	async function start() {
		const id = ++searchId;
		button.disabled = false;
		button.textContent = idleLabel();
		currentButton.disabled = false;
		currentButton.textContent = "현재 위치로 찾기";
		result.replaceChildren();
		section.hidden = false;
		if (originLookup) {
			findRestaurants(false, true);
		} else if (placeInput.value.trim()) {
			findRestaurants(false);
		} else if (await locationAlreadyAllowed() && id === searchId) {
			findRestaurants(true);
		}
	}

	// 카카오 장소 검색 창에서 고른 곳으로 찾아요. 카카오를 못 불러오면 위치 칸에 직접 적는 방식으로 돌아가요.
	async function choosePlace() {
		const chosen = await picker.open(placeInput.value.trim());
		if (chosen) {
			pickedOrigin = chosen;
			placeInput.value = chosen.label;
			findRestaurants(false);
		} else if (picker.failed) {
			placeInput.readOnly = false;
			placeInput.focus();
		}
	}

	async function findRestaurants(useCurrentPosition, reuseOrigin = false) {
		const place = useCurrentPosition ? "" : placeInput.value.trim();
		if (!reuseOrigin && !useCurrentPosition && !place) {
			showMessage("동네나 역 이름을 입력해 주세요.", menu, "");
			placeInput.focus();
			return;
		}
		const picked = pickedOrigin?.label === place ? pickedOrigin : null;
		const id = ++searchId;
		const target = menu;
		const pool = filterMenus;
		const asList = listMode;
		const matchedMenu = queryMenu;
		let origin = null;
		try {
			setBusy(useCurrentPosition ? "위치 확인 중…" : "위치 찾는 중…", useCurrentPosition);
			if (!reuseOrigin) {
				originLookup = useCurrentPosition ? currentPosition() : picked ? Promise.resolve(picked) : geocode(place);
			}
			origin = await originLookup;
			// 위치를 기다리는 사이 새 검색이 시작됐으면 여기서 멈춰요. 계속 가면 새 검색 버튼을 '식당 찾는 중…'으로 다시 잠가요.
			if (id !== searchId) {
				return;
			}
			setBusy("식당 찾는 중…", useCurrentPosition);
			if (asList) {
				const found = await searchStores(target.name, matchedMenu, origin);
				if (id === searchId) {
					renderList(target, origin, found);
				}
				return;
			}
			const found = await searchRestaurants(target, pool, origin);
			if (id === searchId) {
				render(target, origin, found);
			}
		} catch (error) {
			if (id === searchId) {
				if (!origin) {
					originLookup = null;
				}
				showMessage(error.message, target, place);
			}
		} finally {
			if (id === searchId) {
				button.disabled = false;
				button.textContent = idleLabel();
				currentButton.disabled = false;
				currentButton.textContent = "현재 위치로 찾기";
			}
		}
	}

	function idleLabel() {
		return listMode ? "주변 가게 찾기" : "주변 '" + menu.name + "' 식당 추천";
	}

	function renderList(target, origin, found) {
		if (found.places.length === 0) {
			showMessage(origin.label + " 근처 " + found.searchedKm + "km 안에서 '" + target.name + "' 가게를 찾지 못했어요.", target, origin);
			return;
		}
		const nodes = [];
		if (found.wider) {
			nodes.push(paragraph("nearby-note", "2km 안에 맞는 가게가 없어서 5km까지 찾았어요."));
		}
		nodes.push(othersList(found.places, origin.label + " 근처 '" + target.name + "' " + found.places.length + "곳"), footer(target, origin));
		result.replaceChildren(...nodes);
	}

	function setBusy(label, useCurrentPosition) {
		button.disabled = true;
		currentButton.disabled = true;
		button.textContent = useCurrentPosition ? idleLabel() : label;
		currentButton.textContent = useCurrentPosition ? label : "현재 위치로 찾기";
	}

	function render(target, origin, found) {
		if (!found.pick) {
			showMessage(origin.label + " 근처 " + found.searchedKm + "km 안에서 조건에 맞는 식당을 찾지 못했어요.", target, origin);
			return;
		}
		const nodes = [];
		if (found.wider) {
			nodes.push(paragraph("nearby-note", "2km 안에 맞는 가게가 없어서 5km까지 찾았어요."));
		}
		if (found.mode === "filter") {
			nodes.push(paragraph("nearby-note", "'" + target.name + "' 파는 곳은 못 찾아서, 같은\u00a0조건의 '" + found.pick.menuName + "' 가게를 골랐어요."));
		} else if (found.mode === "broad") {
			const chosen = found.broadTerm
				? "이름에 '" + found.broadTerm + "'" + subjectParticle(found.broadTerm) + " 들어간\u00a0가게를"
				: "'" + found.broadCategory + "'\u00a0가게를";
			nodes.push(paragraph("nearby-note", "'" + target.name + "'" + subjectParticle(target.name) + " 주력인 가게는 못 찾아서, " + chosen + " 골랐어요."));
		} else if (found.mode === "similar") {
			nodes.push(paragraph("nearby-note", "조건에 맞는 가게를 못 찾아서, 근처 " + similarLabel(target) + "을 골랐어요."));
		}
		const hasOthers = found.others.length > 0;
		nodes.push(restaurantCard(found.pick, origin, !hasOthers));
		if (hasOthers) {
			nodes.push(othersList(found.others, othersTitle(target, found), [found.pick, ...found.others]));
		}
		nodes.push(footer(target, origin));
		result.replaceChildren(...nodes);
	}

	function showMessage(text, target, where) {
		result.replaceChildren(paragraph("nearby-message", text), footer(target, where));
	}
}

// 마지막 글자에 받침이 있으면 '이', 없거나 한글이 아니면 '가'
function subjectParticle(word) {
	const code = word.charCodeAt(word.length - 1) - 0xac00;
	return code >= 0 && code <= 11171 && code % 28 !== 0 ? "이" : "가";
}

function othersTitle(target, found) {
	if (found.othersSameMenu) {
		return "'" + target.name + "' 파는 다른 가까운 곳";
	}
	if (found.othersBroad || found.mode === "broad") {
		return "비슷한 다른 가까운 곳";
	}
	return found.mode === "similar" ? "다른 가까운 곳" : "조건에 맞는 다른 가까운 곳";
}
