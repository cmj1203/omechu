import { getSupabase } from "./supabase.js";
import { addressOf, currentPosition, geocode } from "./nearby-location.js";
import { initPlacePicker } from "./place-picker.js";
import { loadMenus } from "./menus.js";
import { walkMinutes } from "./nearby-database.js";
import { formatDistance, kakaoMapUrl, restaurantCard } from "./nearby-renderer.js";
import { placeNameLink } from "./place-page.js";
import { metersBetween, placeKey, searchRestaurants, searchStores } from "./nearby-restaurant-search.js";

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 3;
const MAX_LENGTH = 30;
const REFRESH_MS = 10_000;
const VOTER_KEY = "omechu.voterId";
const HOST_KEY_PREFIX = "omechu.pollHost.";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND_TEXT = "투표를 찾을 수 없어요. 링크가 맞는지 확인해 주세요.";
const EXPIRED_TEXT = "이 투표는 마감됐어요.";
const SAVE_FAILED_TEXT = "답을 저장하지 못했어요. 잠시 후 다시 눌러 주세요.";
const NO_AREA_TEXT = "모일 곳을 먼저 정해 주세요.";
const NO_RESTAURANT_TEXT = "근처에서 식당을 찾지 못했어요.";
// 식당 객체의 글자 길이 한도예요. DB(create_menu_poll)가 같은 값으로 검사해요.
const MAX_RESTAURANT_NAME = 80;
const MAX_RESTAURANT_INFO = 200;
const MAX_RESTAURANT_KEY = 80;

const views = {
	loading: document.getElementById("loadingView"),
	create: document.getElementById("createView"),
	poll: document.getElementById("pollView"),
	notice: document.getElementById("noticeView"),
};
const optionCount = document.getElementById("optionCount");
const optionChips = document.getElementById("optionChips");
const addForm = document.getElementById("addForm");
const optionInput = document.getElementById("optionInput");
const addButton = document.getElementById("addButton");
const placeInput = document.getElementById("pollPlace");
const currentButton = document.getElementById("pollCurrentButton");
const createButton = document.getElementById("createButton");
const createMessage = document.getElementById("createMessage");
const deadline = document.getElementById("deadline");
const pollArea = document.getElementById("pollArea");
const answerForm = document.getElementById("answerForm");
const answerOptions = document.getElementById("answerOptions");
const answerButton = document.getElementById("answerButton");
const resultBox = document.getElementById("resultBox");
const responders = document.getElementById("responders");
const resultList = document.getElementById("resultList");
const resultNote = document.getElementById("resultNote");
const editButton = document.getElementById("editButton");
const restartLink = document.getElementById("restartLink");
const confirmedBox = document.getElementById("confirmedBox");
const confirmedName = document.getElementById("confirmedName");
const restaurantLink = document.getElementById("restaurantLink");
const confirmedRestaurant = document.getElementById("confirmedRestaurant");
const pollMessage = document.getElementById("pollMessage");
const refreshButton = document.getElementById("refreshButton");
const shareButton = document.getElementById("shareButton");
const noticeText = document.getElementById("noticeText");

const params = new URLSearchParams(location.search);
const voter = readVoter();
let draft = parseMenus(params.get("menus"));
// 후보별 식당(없으면 null). draft 와 길이가 같고, DB 에도 같은 모양으로 들어가요.
let restaurants = initialRestaurants(params, draft.length);
let area = initialArea(params);
let poll = null;
let state = null;
let editing = false;
let refreshTimer = null;
let shareTimer = null;
let picker = null;
let restaurantPicker = null;
let menusPromise = null;
const sessionHostTokens = new Map();

addForm.addEventListener("submit", (event) => {
	event.preventDefault();
	const name = optionInput.value.trim();
	if (!name) {
		return;
	}
	if (draft.includes(name)) {
		setMessage(createMessage, "이미 있는 후보예요.", true);
		return;
	}
	if (draft.length >= MAX_OPTIONS) {
		setMessage(createMessage, "후보는 3개까지예요.", true);
		return;
	}
	draft = [...draft, name];
	restaurants = [...restaurants, null];
	optionInput.value = "";
	renderDraft();
});

placeInput.addEventListener("click", async () => {
	if (!placeInput.readOnly) {
		return;
	}
	picker ??= initPlacePicker(document.getElementById("placePicker"));
	const chosen = await picker.open(placeInput.value.trim());
	if (chosen) {
		area = chosen;
		renderDraft();
	} else if (picker.failed) {
		placeInput.readOnly = false;
		placeInput.focus();
	}
});
placeInput.addEventListener("input", () => {
	area = placeInput.value.trim() ? { label: placeInput.value.trim().slice(0, 60) } : null;
	renderDraft();
});
currentButton.addEventListener("click", async () => {
	currentButton.disabled = true;
	setMessage(createMessage, "현재 위치를 확인하고 있어요.", false);
	try {
		const origin = await currentPosition();
		const address = await addressOf(origin);
		area = { label: (address ?? origin.label).slice(0, 60), lat: origin.lat, lng: origin.lng };
		renderDraft();
	} catch (error) {
		setMessage(createMessage, error.message, true);
	} finally {
		currentButton.disabled = false;
	}
});

createButton.addEventListener("click", async () => {
	if (draft.length < MIN_OPTIONS || !area) {
		return;
	}
	createButton.disabled = true;
	createButton.textContent = "만드는 중…";
	setMessage(createMessage, "", false);
	try {
		const where = Number.isFinite(area.lat) ? area : { ...(await geocode(area.label)), label: area.label };
		const supabase = await requireSupabase();
		const { data, error } = await supabase.rpc("create_menu_poll", {
			p_options: draft,
			p_area_label: where.label,
			p_area_lat: where.lat,
			p_area_lng: where.lng,
			p_restaurants: restaurants,
		});
		if (error) {
			throw error;
		}
		const created = data[0];
		saveHostToken(created.id, created.host_token);
		history.replaceState(null, "", location.pathname + "?id=" + created.id);
		await openPoll(created.id);
	} catch (error) {
		console.error(error);
		setMessage(createMessage, error.code === "P0001" || !error.code ? error.message : "투표를 만들지 못했어요. 잠시 후 다시 눌러 주세요.", true);
	} finally {
		createButton.textContent = "투표 만들기";
		renderDraft();
	}
});

answerForm.addEventListener("change", updateAnswerButton);
answerForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const accepted = [...answerOptions.querySelectorAll("input:checked")].map((input) => Number(input.value));
	answerButton.disabled = true;
	setMessage(pollMessage, "", false);
	try {
		const supabase = await requireSupabase();
		const { error } = await supabase.rpc("submit_menu_poll_response", { p_poll: poll.id, p_voter: voter, p_accepted: accepted });
		if (error) {
			throw error;
		}
		editing = false;
		await refresh();
	} catch (error) {
		console.error(error);
		setMessage(pollMessage, error.code === "P0001" ? error.message : SAVE_FAILED_TEXT, true);
		await refresh();
	} finally {
		answerButton.disabled = false;
	}
});

editButton.addEventListener("click", () => {
	editing = true;
	render();
	answerOptions.querySelector("input")?.focus();
});

refreshButton.addEventListener("click", () => {
	setMessage(pollMessage, "", false);
	refresh();
});

// 휴대폰은 기본 공유 창(카톡 등)을 열고, 공유 창이 없거나 열지 못하는 브라우저에서는 링크를 복사해요.
shareButton.addEventListener("click", async () => {
	const url = location.origin + location.pathname + "?id=" + poll.id;
	// 식당이 붙은 후보는 '백반 · 목포생태찌개'처럼 식당 이름을 같이 써요.
	const candidates = state.options.map((name, index) => {
		const restaurant = restaurantAt(index);
		return restaurant ? name + " · " + restaurant.name : name;
	});
	const text = "먹을 수 있는 메뉴를 골라 주세요. 후보: " + candidates.join(", ") + " (모일 곳: " + state.area.label + ")";
	if (navigator.share) {
		try {
			await navigator.share({ title: "오메추 같이 정하기", text, url });
			return;
		} catch (error) {
			if (error.name === "AbortError") {
				return;
			}
		}
	}
	try {
		await navigator.clipboard.writeText(text + "\n" + url);
		flashShareLabel("복사했어요");
	} catch {
		flashShareLabel("공유하지 못했어요");
	}
});

document.addEventListener("visibilitychange", () => {
	if (!document.hidden && poll) {
		refresh();
	}
});

if (params.get("id")) {
	await openPoll(params.get("id"));
} else {
	renderDraft();
	show("create");
}

async function openPoll(id) {
	if (!UUID_PATTERN.test(id)) {
		showNotice(NOT_FOUND_TEXT);
		return;
	}
	poll = { id, hostToken: readHostToken(id) };
	await refresh();
	// 다른 사람이 답하면 결과가 바뀌어서, 화면을 보는 동안만 10초마다 다시 읽어요. 답 칸은 다시 그리지 않아 고르던 것이 지워지지 않아요.
	clearInterval(refreshTimer);
	refreshTimer = setInterval(() => {
		if (!document.hidden && state && state.confirmed_index === null) {
			refresh();
		}
	}, REFRESH_MS);
}

async function refresh() {
	refreshButton.disabled = true;
	try {
		const supabase = await requireSupabase();
		const { data, error } = await supabase.rpc("menu_poll_state", { p_poll: poll.id, p_voter: voter, p_host_token: poll.hostToken });
		if (error) {
			throw error;
		}
		if (!data) {
			showNotice(NOT_FOUND_TEXT);
			return;
		}
		state = data;
		render();
	} catch (error) {
		console.error(error);
		if (state) {
			setMessage(pollMessage, "결과를 불러오지 못했어요. 잠시 후 다시 눌러 주세요.", true);
		} else {
			showNotice("투표를 불러오지 못했어요. 잠시 후 새로고침해 주세요.");
		}
	} finally {
		refreshButton.disabled = false;
	}
}

function render() {
	const confirmed = state.confirmed_index !== null;
	if (!confirmed && new Date(state.expires_at) <= Date.now()) {
		showNotice(EXPIRED_TEXT);
		return;
	}
	pollArea.textContent = "모일 곳 · " + state.area.label;
	deadline.textContent = confirmed ? "" : formatRemaining(new Date(state.expires_at) - Date.now());
	confirmedBox.hidden = !confirmed;
	refreshButton.hidden = confirmed;
	if (confirmed) {
		clearInterval(refreshTimer);
		answerForm.hidden = true;
		resultBox.hidden = true;
		const name = state.options[state.confirmed_index];
		confirmedName.textContent = name;
		// 식당이 붙어 있으면 추천 식당 상자(길찾기·지도·공유)를 바로 보여 주고, '근처 식당 보기'는 그 아래 글자 단추로 내려요.
		const restaurant = restaurantAt(state.confirmed_index);
		confirmedRestaurant.replaceChildren(...(restaurant ? [restaurantCard({ ...withDistance(restaurant), menuName: name }, state.area, false)] : []));
		restaurantLink.className = restaurant ? "text-button vote-go-text" : "primary vote-create vote-go";
		restaurantLink.href = "index.html?" + new URLSearchParams({
			menu: name,
			place: state.area.label,
			lat: state.area.lat,
			lng: state.area.lng,
		});
		show("poll");
		return;
	}
	const answering = editing || state.mine === null;
	if (answering && answerForm.hidden) {
		renderAnswerForm();
	}
	answerForm.hidden = !answering;
	resultBox.hidden = answering || state.counts === null;
	if (!resultBox.hidden) {
		renderResults();
	}
	editButton.hidden = answering || state.mine === null;
	show("poll");
}

function renderAnswerForm() {
	const mine = new Set(state.mine ?? []);
	answerOptions.replaceChildren(...state.options.map((name, index) => {
		const label = document.createElement("label");
		label.className = "vote-check";
		const input = document.createElement("input");
		input.type = "checkbox";
		input.value = String(index);
		input.checked = mine.has(index);
		const body = document.createElement("span");
		body.className = "vote-check-body";
		const text = document.createElement("span");
		text.className = "vote-check-name";
		text.id = "voteOption" + index;
		text.textContent = name;
		body.append(text);
		// 고를 항목의 이름은 메뉴 이름만 읽히게 하고, 식당 정보는 설명으로 붙여요.
		input.setAttribute("aria-labelledby", text.id);
		const restaurant = restaurantAt(index);
		if (restaurant) {
			label.classList.add("has-restaurant");
			const block = restaurantBlock(withDistance(restaurant));
			block.id = "voteOptionPlace" + index;
			input.setAttribute("aria-describedby", block.id);
			body.append(block);
		}
		label.append(input, body);
		return label;
	}));
	updateAnswerButton();
}

// 답하기 줄의 식당 칸: 이름(가게 페이지 링크), 모일 곳에서 도보 시간·거리, 주소, 지도 링크.
// 가게 이름·지도 링크는 label 안의 링크라 눌러도 체크 상자가 바뀌지 않고(링크는 label 이 켜지지 않는 대상이에요), 다른 곳을 누르면 체크 상자가 바뀌어요.
function restaurantBlock(restaurant) {
	const block = document.createElement("span");
	block.className = "vote-check-place";
	const name = document.createElement("strong");
	name.append(placeNameLink(restaurant));
	const walk = document.createElement("span");
	walk.textContent = "도보 약 " + restaurant.walkMinutes + "분\u00a0· " + formatDistance(restaurant.distance);
	block.append(name, walk);
	if (restaurant.address) {
		const address = document.createElement("span");
		address.textContent = restaurant.address;
		block.append(address);
	}
	const map = document.createElement("a");
	map.className = "vote-map-link";
	map.href = kakaoMapUrl(restaurant);
	map.target = "_blank";
	map.rel = "noopener";
	map.textContent = "지도에서 보기 ↗";
	block.append(map);
	return block;
}

function updateAnswerButton() {
	const any = answerOptions.querySelector("input:checked");
	answerButton.textContent = any ? "보내기" : "다 못 먹어요";
}

function renderResults() {
	const total = state.responders;
	const common = new Set(state.common);
	responders.textContent = "응답 " + total + "명";
	resultList.replaceChildren(...state.options.map((name, index) => {
		const item = document.createElement("li");
		item.className = "vote-result" + (common.has(index) ? " is-common" : "");
		const text = document.createElement("span");
		text.className = "vote-option-text";
		const label = document.createElement("span");
		label.className = "vote-option-name";
		label.textContent = name;
		text.append(label);
		const restaurant = restaurantAt(index);
		if (restaurant) {
			const shop = document.createElement("span");
			shop.className = "vote-option-restaurant";
			shop.append(placeNameLink(restaurant));
			text.append(shop);
		}
		const count = document.createElement("span");
		count.className = "vote-option-count";
		count.textContent = common.has(index) ? "모두 가능" : state.counts[index] + "/" + total + "명";
		item.append(text, count);
		if (state.is_host && common.has(index)) {
			const confirm = document.createElement("button");
			confirm.type = "button";
			confirm.className = "vote-share vote-confirm";
			confirm.textContent = "이걸로 정하기";
			confirm.addEventListener("click", () => confirmMenu(index, confirm));
			item.append(confirm);
		}
		return item;
	}));
	const noCommon = total > 0 && common.size === 0;
	resultNote.textContent = noCommon ? "모두 먹을 수 있는 메뉴가 없어요." : common.size > 0 && !state.is_host ? "만든 사람이 정하면 여기에 나와요." : "";
	restartLink.hidden = !(noCommon && state.is_host);
	restartLink.href = "vote.html?" + new URLSearchParams({ place: state.area.label });
}

async function confirmMenu(index, button) {
	button.disabled = true;
	setMessage(pollMessage, "", false);
	try {
		const supabase = await requireSupabase();
		const { error } = await supabase.rpc("confirm_menu_poll", { p_poll: poll.id, p_host_token: poll.hostToken, p_index: index });
		if (error) {
			throw error;
		}
	} catch (error) {
		console.error(error);
		setMessage(pollMessage, error.code === "P0001" ? error.message : "정하지 못했어요. 잠시 후 다시 눌러 주세요.", true);
		button.disabled = false;
	}
	await refresh();
}

function renderDraft() {
	optionCount.textContent = String(draft.length);
	optionChips.replaceChildren(...draft.map(candidateRow));
	const full = draft.length >= MAX_OPTIONS;
	optionInput.disabled = full;
	addButton.disabled = full;
	if (area && placeInput.value !== area.label) {
		placeInput.value = area.label;
	}
	createButton.disabled = draft.length < MIN_OPTIONS || !area;
	if (draft.length < MIN_OPTIONS) {
		setMessage(createMessage, "후보를 2개 이상 넣어 주세요.", false);
	} else if (!area) {
		setMessage(createMessage, "모일 곳을 정해 주세요.", false);
	} else if (createMessage.dataset.state !== "error") {
		setMessage(createMessage, "", false);
	}
}

// 후보 한 줄: 메뉴 이름과 ×, 그 아래에 붙은 식당 이름·'식당 떼기' 또는 '식당 붙이기'.
function candidateRow(name, index) {
	const item = document.createElement("li");
	item.className = "vote-candidate";
	const label = document.createElement("span");
	label.className = "vote-candidate-name";
	label.textContent = name;
	const remove = document.createElement("button");
	remove.type = "button";
	remove.className = "vote-chip-remove";
	remove.setAttribute("aria-label", name + " 빼기");
	remove.addEventListener("click", () => {
		draft = draft.filter((_, other) => other !== index);
		restaurants = restaurants.filter((_, other) => other !== index);
		renderDraft();
	});
	const place = document.createElement("div");
	place.className = "vote-candidate-place";
	const restaurant = restaurants[index];
	if (restaurant) {
		const shop = document.createElement("span");
		shop.className = "vote-candidate-restaurant";
		shop.append(placeNameLink(restaurant));
		place.append(shop, textButton("식당 떼기", name, () => {
			restaurants = restaurants.map((other, i) => (i === index ? null : other));
			renderDraft();
		}));
	} else {
		place.append(textButton("식당 붙이기", name, (button) => attachRestaurant(index, button)));
	}
	item.append(label, remove, place);
	return item;
}

// 글자 단추. 같은 글자의 단추가 후보마다 있어서 화면 읽기 도구에는 메뉴 이름을 앞에 붙여 읽어 줘요.
function textButton(label, menuName, onClick) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "text-button";
	button.textContent = label;
	button.setAttribute("aria-label", menuName + " " + label);
	button.addEventListener("click", () => onClick(button));
	return button;
}

// '식당 붙이기': 모일 곳 근처에서 그 후보를 파는 식당을 창에 보여 주고, 고른 식당을 그 후보에 붙여요.
// 모일 곳이 글자만 있으면(메인에서 좌표 없이 넘어옴) '투표 만들기'처럼 먼저 좌표를 찾고, 모일 곳이 없으면 안내만 해요.
async function attachRestaurant(index, button) {
	if (!area) {
		setMessage(createMessage, NO_AREA_TEXT, true);
		return;
	}
	const name = draft[index];
	button.disabled = true;
	restaurantPicker ??= initRestaurantPicker(document.getElementById("restaurantPicker"));
	try {
		const chosen = await restaurantPicker.pick(name + " · " + area.label + " 근처", async () => {
			if (!Number.isFinite(area.lat)) {
				area = { ...(await geocode(area.label)), label: area.label };
			}
			const menu = await menuNamed(name);
			return menu ? restaurantsFor(menu, area) : (await searchStores(name, [], area)).places;
		});
		if (chosen) {
			restaurants = restaurants.map((other, i) => (i === index ? toRestaurant(chosen) : other));
			renderDraft();
		}
	} finally {
		button.disabled = false;
	}
}

// 후보 이름과 같은 메뉴(띄어쓰기 무시)가 있으면 그 메뉴예요. 없으면 null 이고, 그럴 때는 이름에 그 말이 든 가게를 찾아요.
async function menuNamed(name) {
	menusPromise ??= loadMenus().then(({ menus }) => menus).catch((error) => {
		console.warn("메뉴 목록을 불러오지 못해서 가게 이름으로만 찾아요.", error);
		menusPromise = null;
		return [];
	});
	const wanted = compactName(name);
	return (await menusPromise).find((menu) => compactName(menu.name) === wanted) ?? null;
}

function compactName(text) {
	return text.replace(/\s+/g, "").toLowerCase();
}

// 메뉴 추천과 같은 방식으로 고른 가게를 맨 위에, 다른 가까운 곳을 그 아래에 둬요.
async function restaurantsFor(menu, origin) {
	const found = await searchRestaurants(menu, [menu], origin);
	return found.pick ? [found.pick, ...found.others] : [];
}

// DB·URL 에 담는 식당 객체. 평점·영업시간처럼 그때그때 바뀌는 값은 빼고 이름·주소·전화·좌표만 남기고, 길이 한도도 같이 맞춰요.
function toRestaurant(place) {
	return normalizeRestaurant({ key: placeKey(place), name: place.name, address: place.address, phone: place.phone, lat: place.lat, lng: place.lng });
}

// 식당 고르는 창. 위치 찾기 창과 같은 모양이고, 고른 식당을, 닫기·Esc 면 null 을 돌려줘요.
function initRestaurantPicker(dialog) {
	const title = dialog.querySelector(".restaurant-picker-title");
	const message = dialog.querySelector(".place-picker-message");
	const list = dialog.querySelector(".place-picker-results");
	let picked = null;
	let resolvePick = null;
	let searchId = 0;

	dialog.querySelector(".place-picker-close").addEventListener("click", () => dialog.close());
	dialog.addEventListener("close", () => {
		const done = resolvePick;
		resolvePick = null;
		done?.(picked);
	});

	return {
		// 창을 열고 '찾는 중…'을 보여 준 뒤 find 가 돌려준 식당 목록을 그려요. 찾는 동안 창을 닫았거나 다른 후보로 다시 열었으면 그 결과는 버려요.
		async pick(heading, find) {
			const id = ++searchId;
			picked = null;
			title.textContent = heading;
			list.replaceChildren();
			showMessage("찾는 중…");
			dialog.showModal();
			// 열자마자 초점을 제목에 두어, '닫기'에 테두리가 생겨 골라 둔 것처럼 보이지 않게 해요(사파리).
			title.focus();
			const done = new Promise((resolve) => {
				resolvePick = resolve;
			});
			try {
				const places = await find();
				if (id === searchId && dialog.open) {
					showMessage(places.length === 0 ? NO_RESTAURANT_TEXT : "");
					list.replaceChildren(...places.map(resultItem));
					list.scrollTop = 0;
				}
			} catch (error) {
				console.error(error);
				if (id === searchId && dialog.open) {
					showMessage(error.message);
				}
			}
			return done;
		},
	};

	function resultItem(place) {
		const button = document.createElement("button");
		button.type = "button";
		const name = document.createElement("strong");
		name.textContent = place.name;
		const walk = document.createElement("span");
		walk.className = "place-pick-walk";
		walk.textContent = "도보 약 " + place.walkMinutes + "분\u00a0· " + formatDistance(place.distance);
		button.append(name, walk);
		if (place.address) {
			const address = document.createElement("span");
			address.className = "place-pick-address";
			address.textContent = place.address;
			button.append(address);
		}
		button.addEventListener("click", () => {
			picked = place;
			dialog.close();
		});
		const item = document.createElement("li");
		item.append(button);
		return item;
	}

	function showMessage(text) {
		message.textContent = text;
		message.hidden = !text;
	}
}

// 투표의 index 번 후보에 붙은 식당. 식당 칸이 없는 옛 투표나 모양이 어긋나는 값은 식당이 없는 것으로 봐요.
function restaurantAt(index) {
	return Array.isArray(state.restaurants) ? normalizeRestaurant(state.restaurants[index]) : null;
}

// 모일 곳에서 식당까지 직선거리와 도보 시간을 붙여요(주변 식당 결과와 같은 계산).
function withDistance(restaurant) {
	const distance = Math.round(metersBetween(state.area, restaurant));
	return { ...restaurant, distance, walkMinutes: walkMinutes(distance) };
}

function formatRemaining(ms) {
	const hours = Math.floor(ms / 3_600_000);
	if (hours >= 1) {
		return hours + "시간 뒤 마감";
	}
	const minutes = Math.floor(ms / 60_000);
	if (minutes >= 1) {
		return minutes + "분 뒤 마감";
	}
	return "곧 마감";
}

function flashShareLabel(label) {
	shareButton.textContent = label;
	clearTimeout(shareTimer);
	shareTimer = setTimeout(() => {
		shareButton.textContent = "링크 공유하기";
	}, 2000);
}

function showNotice(text) {
	clearInterval(refreshTimer);
	noticeText.textContent = text;
	show("notice");
}

function show(name) {
	for (const [key, view] of Object.entries(views)) {
		view.hidden = key !== name;
	}
}

function setMessage(element, text, isError) {
	element.textContent = text;
	if (isError) {
		element.dataset.state = "error";
	} else {
		delete element.dataset.state;
	}
}

async function requireSupabase() {
	const supabase = await getSupabase();
	if (!supabase) {
		throw new Error("Supabase 설정이 없어요.");
	}
	return supabase;
}

// 메인에서 넘어온 모일 곳. 좌표까지 오면 그대로 쓰고, 글자만 오면 만들 때 좌표를 찾아요.
function initialArea(query) {
	const label = query.get("place")?.trim().slice(0, 60);
	if (!label) {
		return null;
	}
	const lat = Number(query.get("lat"));
	const lng = Number(query.get("lng"));
	return query.get("lat") && query.get("lng") && Number.isFinite(lat) && Number.isFinite(lng) ? { label, lat, lng } : { label };
}

// 메인에서 넘어온 식당(restaurant, JSON)은 첫 후보에만 붙어요. JSON 이 아니거나 모양이 어긋나면 식당 없이 시작해요.
function initialRestaurants(query, count) {
	const list = Array.from({ length: count }, () => null);
	if (count === 0) {
		return list;
	}
	try {
		list[0] = normalizeRestaurant(JSON.parse(query.get("restaurant")));
	} catch {
		// restaurant 가 JSON 이 아니면 식당 없이 시작해요.
	}
	return list;
}

// 식당 객체(URL 의 restaurant, DB 의 restaurants 원소)를 화면이 쓰는 모양으로 맞춰요.
// 이름·좌표가 없거나 범위를 벗어나면 null(식당 없음)이고, key 가 없으면 placeKey 로 맞춰요.
function normalizeRestaurant(raw) {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return null;
	}
	const name = typeof raw.name === "string" ? raw.name.trim().slice(0, MAX_RESTAURANT_NAME) : "";
	const { lat, lng } = raw;
	if (!name || typeof lat !== "number" || typeof lng !== "number" || !(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) {
		return null;
	}
	const key = typeof raw.key === "string" && raw.key && raw.key.length <= MAX_RESTAURANT_KEY ? raw.key : placeKey({ name, lat, lng }).slice(0, MAX_RESTAURANT_KEY);
	return { key, name, address: optionalText(raw.address), phone: optionalText(raw.phone), lat, lng };
}

function optionalText(value) {
	return typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_RESTAURANT_INFO) : null;
}

function parseMenus(raw) {
	if (!raw) {
		return [];
	}
	const names = [];
	for (const part of raw.split(",")) {
		const name = part.trim().slice(0, MAX_LENGTH);
		if (name && !names.includes(name)) {
			names.push(name);
		}
		if (names.length === MAX_OPTIONS) {
			break;
		}
	}
	return names;
}

// 방장 확인 키는 만든 브라우저에만 둬요. 이 키가 있어야 '이걸로 정하기'를 할 수 있어요.
function saveHostToken(id, token) {
	try {
		localStorage.setItem(HOST_KEY_PREFIX + id, token);
	} catch {
		// 저장이 막힌 브라우저(사생활 보호 모드 등)에서는 이 화면을 연 동안만 방장이에요.
	}
	sessionHostTokens.set(id, token);
}

function readHostToken(id) {
	try {
		return localStorage.getItem(HOST_KEY_PREFIX + id) ?? sessionHostTokens.get(id) ?? null;
	} catch {
		return sessionHostTokens.get(id) ?? null;
	}
}

// 같은 브라우저가 한 투표에 답 하나만 낼 수 있게, 이 기기에 무작위 글자열을 만들어 두고 답마다 같이 보내요.
function readVoter() {
	try {
		const saved = localStorage.getItem(VOTER_KEY);
		if (saved && saved.length >= 8 && saved.length <= 64) {
			return saved;
		}
		const fresh = randomId();
		localStorage.setItem(VOTER_KEY, fresh);
		return fresh;
	} catch {
		// 저장이 막힌 브라우저(사생활 보호 모드 등)에서는 이 화면을 연 동안만 같은 글자열을 써요.
		return randomId();
	}
}

function randomId() {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
