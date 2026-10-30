import { getSupabase } from "./supabase.js";
import { addressOf, currentPosition, geocode } from "./nearby-location.js";
import { initPlacePicker } from "./place-picker.js";

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
const pollMessage = document.getElementById("pollMessage");
const refreshButton = document.getElementById("refreshButton");
const shareButton = document.getElementById("shareButton");
const noticeText = document.getElementById("noticeText");

const params = new URLSearchParams(location.search);
const voter = readVoter();
let draft = parseMenus(params.get("menus"));
let area = initialArea(params);
let poll = null;
let state = null;
let editing = false;
let refreshTimer = null;
let shareTimer = null;
let picker = null;
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
	const text = "먹을 수 있는 메뉴를 골라 주세요. 후보: " + state.options.join(", ") + " (모일 곳: " + state.area.label + ")";
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
		const text = document.createElement("span");
		text.textContent = name;
		label.append(input, text);
		return label;
	}));
	updateAnswerButton();
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
		const label = document.createElement("span");
		label.className = "vote-option-name";
		label.textContent = name;
		const count = document.createElement("span");
		count.className = "vote-option-count";
		count.textContent = common.has(index) ? "모두 가능" : state.counts[index] + "/" + total + "명";
		item.append(label, count);
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
	optionChips.replaceChildren(...draft.map(chip));
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

function chip(name) {
	const item = document.createElement("li");
	item.className = "vote-chip";
	const label = document.createElement("span");
	label.textContent = name;
	const remove = document.createElement("button");
	remove.type = "button";
	remove.className = "vote-chip-remove";
	remove.setAttribute("aria-label", name + " 빼기");
	remove.addEventListener("click", () => {
		draft = draft.filter((other) => other !== name);
		renderDraft();
	});
	item.append(label, remove);
	return item;
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
