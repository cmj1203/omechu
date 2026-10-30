import { addressOf, currentPosition, geocode, locationAlreadyAllowed } from "./nearby-location.js";
import { footer, othersList, paragraph, restaurantCard, similarLabel } from "./nearby-renderer.js";
import { placeKey, searchRestaurants, searchStores } from "./nearby-restaurant-search.js";
import { initPlacePicker } from "./place-picker.js";
import { RATINGS_ENABLED } from "./place-rating.js";

// 평점 우선·거리 우선 중 고른 것은 이 기기에 기억해요. 처음에는 평점 우선이에요.
const ORDER_KEY = "omechu.recommendOrder";
let picker = null;

export function initNearby(section) {
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
	let busy = false;
	// '다른 가게'로 이미 보여 준 가게. 메뉴·위치·추천 기준이 바뀌면 비워요.
	const shown = new Set();
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

	// 따로 '찾기' 단추 없이, 위치 칸을 눌러 장소를 고르면 바로 그곳으로 추천해요.
	currentButton.addEventListener("click", () => findRestaurants(true));
	placeInput.addEventListener("click", () => {
		if (placeInput.readOnly && !busy) {
			choosePlace();
		}
	});
	// 위치 칸에 직접 적는 방식에서 글자를 바꾸면, 필터를 바꿀 때 새로 적은 곳으로 찾아요.
	placeInput.addEventListener("input", () => {
		originLookup = null;
	});
	placeInput.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" || busy) {
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
		// 같이 정하기에서 정한 모일 곳({ label, lat, lng })을 위치 칸에 넣어, 다음 추천이 그 좌표로 찾게 해요.
		// 위치 칸 글자와 맞는 좌표를 이미 알면 돌려줘요(장소 창에서 고른 곳·현재 위치). 모르면 null.
		knownOrigin() {
			const typed = placeInput.value.trim();
			return pickedOrigin && typed && (pickedOrigin.inputText ?? pickedOrigin.label) === typed
				? { label: typed, lat: pickedOrigin.lat, lng: pickedOrigin.lng }
				: null;
		},
		setOrigin(origin) {
			pickedOrigin = origin;
			originLookup = null;
			placeInput.value = origin.label;
		},
	};

	async function start() {
		const id = ++searchId;
		busy = false;
		currentButton.disabled = false;
		shown.clear();
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

	// another 면 같은 위치·메뉴로 이미 보여 준 가게를 빼고 다시 골라요('다른 가게' 단추).
	async function findRestaurants(useCurrentPosition, reuseOrigin = false, another = false) {
		const typed = placeInput.value.trim();
		const place = useCurrentPosition ? "" : typed;
		if (!reuseOrigin && !useCurrentPosition && !place) {
			showMessage("동네나 역 이름을 입력해 주세요.", menu, "");
			placeInput.focus();
			return;
		}
		const picked = (pickedOrigin?.inputText ?? pickedOrigin?.label) === place ? pickedOrigin : null;
		const id = ++searchId;
		const target = menu;
		const pool = filterMenus;
		const asList = listMode;
		const matchedMenus = queryMenus;
		const chosenOrder = order;
		if (!another) {
			shown.clear();
		}
		let origin = null;
		try {
			setBusy(useCurrentPosition ? "현재 위치 확인 중…" : "위치 찾는 중…");
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
			setBusy("식당 찾는 중…");
			if (asList) {
				const found = await searchStores(target.name, matchedMenus, origin);
				if (id === searchId) {
					renderList(target, origin, found);
				}
				return;
			}
			const found = await searchRestaurants(target, pool, origin, chosenOrder, shown);
			if (id === searchId) {
				rememberShown(found.pick);
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
				busy = false;
				currentButton.disabled = false;
			}
		}
	}

	// 현재 위치로 찾으면 그 주소를 위치 칸에 넣어 둬요. 그 칸으로 다시 찾으면 주소를 다시 찾지 않고 같은 좌표를 쓰고,
	// 결과에는 주소 대신 계속 '현재 위치에서 도보 약 …'으로 보여 줘요(inputText 는 위치 칸 글자와 맞춰 보는 데만 써요).
	// 주소를 찾는 동안 기다리지 않고 식당부터 찾고, 그사이 위치 칸을 바꿨으면 덮어쓰지 않아요.
	async function showAddress(origin, before) {
		const address = await addressOf(origin);
		if (address && placeInput.value.trim() === before) {
			placeInput.value = address;
			pickedOrigin = { label: origin.label, lat: origin.lat, lng: origin.lng, inputText: address };
		}
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

	// 이미 보여 준 가게가 다시 나왔으면 후보를 다 돈 것이라 처음부터 다시 세요.
	function rememberShown(pick) {
		if (!pick) {
			return;
		}
		if (shown.has(placeKey(pick))) {
			shown.clear();
		}
		shown.add(placeKey(pick));
	}

	// 찾는 동안 결과 자리에 하는 일을 보여 주고, 위치 칸·현재 위치 단추는 꺼 둬요.
	function setBusy(label) {
		busy = true;
		currentButton.disabled = true;
		result.replaceChildren(paragraph("nearby-message", label));
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
		nodes.push(restaurantCard(found.pick, origin, !hasOthers, () => findRestaurants(false, true, true)));
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
