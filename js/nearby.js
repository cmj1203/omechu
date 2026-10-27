import { addressOf, currentPosition, geocode, locationAlreadyAllowed } from "./nearby-location.js";
import { footer, othersList, paragraph, restaurantCard, similarLabel } from "./nearby-renderer.js";
import { searchRestaurants, searchStores } from "./nearby-restaurant-search.js";
import { initPlacePicker } from "./place-picker.js";
import { RATINGS_ENABLED } from "./place-rating.js";

// 평점 우선·거리 우선 중 고른 것은 이 기기에 기억해요. 처음에는 평점 우선이에요.
const ORDER_KEY = "omechu.recommendOrder";
let picker = null;

export function initNearby(section) {
	const button = section.querySelector("#nearbyBtn");
	const currentButton = section.querySelector("#nearbyCurrentBtn");
	const placeInput = section.querySelector("#nearbyPlace");
	const result = section.querySelector("#nearbyResult");
	const orderChoices = section.querySelector("#nearbyOrder");
	let menu = null;
	let filterMenus = [];
	let listMode = false;
	let queryMenus = [];
	let searchId = 0;
	let pickedOrigin = null;
	let originLookup = null;
	let order = readOrder();
	picker ??= initPlacePicker(document.querySelector("#placePicker"));
	orderChoices.querySelector("input[value='" + order + "']").checked = true;

	// 이미 찾은 곳이 있으면 같은 위치에서 바로 다시 골라요.
	orderChoices.addEventListener("change", () => {
		order = orderChoices.querySelector("input:checked").value;
		saveOrder(order);
		if (originLookup) {
			findRestaurants(false, true);
		}
	});

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
		// matchedMenus 가 있으면 그 메뉴를 주력으로 파는 가게를, 없으면 이름에 그 말이 든 가게를 찾아요.
		showSearch(query, matchedMenus) {
			menu = { name: query };
			queryMenus = matchedMenus;
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
		currentButton.textContent = "현재 위치로 추천받기";
		result.replaceChildren();
		// 평점을 못 묻는(구글 키 없음) 때와 가게·메뉴 검색 목록에서는 추천 기준을 고를 일이 없어요.
		orderChoices.hidden = !RATINGS_ENABLED || listMode;
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
		const typed = placeInput.value.trim();
		const place = useCurrentPosition ? "" : typed;
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
		const matchedMenus = queryMenus;
		const chosenOrder = order;
		let origin = null;
		try {
			setBusy(useCurrentPosition ? "위치 확인 중…" : "위치 찾는 중…", useCurrentPosition);
			if (!reuseOrigin) {
				originLookup = useCurrentPosition ? currentPosition() : picked ? Promise.resolve(picked) : geocode(place);
			}
			origin = await originLookup;
			if (useCurrentPosition) {
				showAddress(origin, typed);
			}
			// 위치를 기다리는 사이 새 검색이 시작됐으면 여기서 멈춰요. 계속 가면 새 검색 버튼을 '식당 찾는 중…'으로 다시 잠가요.
			if (id !== searchId) {
				return;
			}
			setBusy("식당 찾는 중…", useCurrentPosition);
			if (asList) {
				const found = await searchStores(target.name, matchedMenus, origin);
				if (id === searchId) {
					renderList(target, origin, found);
				}
				return;
			}
			const found = await searchRestaurants(target, pool, origin, chosenOrder);
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
				currentButton.textContent = "현재 위치로 추천받기";
			}
		}
	}

	// 현재 위치로 찾으면 그 주소를 위치 칸에 넣어 둬요. 그 칸으로 다시 찾으면 주소를 다시 찾지 않고 같은 좌표를 써요.
	// 주소를 찾는 동안 기다리지 않고 식당부터 찾고, 그사이 위치 칸을 바꿨으면 덮어쓰지 않아요.
	async function showAddress(origin, before) {
		const address = await addressOf(origin);
		if (address && placeInput.value.trim() === before) {
			placeInput.value = address;
			pickedOrigin = { label: address, lat: origin.lat, lng: origin.lng };
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
		currentButton.textContent = useCurrentPosition ? label : "현재 위치로 추천받기";
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
		nodes.push(footer(target, origin, RATINGS_ENABLED));
		result.replaceChildren(...nodes);
	}

	function showMessage(text, target, where) {
		result.replaceChildren(paragraph("nearby-message", text), footer(target, where));
	}
}

function readOrder() {
	try {
		return localStorage.getItem(ORDER_KEY) === "distance" ? "distance" : "rating";
	} catch {
		return "rating";
	}
}

function saveOrder(order) {
	try {
		localStorage.setItem(ORDER_KEY, order);
	} catch {
		// 저장이 막힌 브라우저(사생활 보호 모드 등)에서는 이 화면을 연 동안만 기억해요.
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
