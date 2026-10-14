import { getSupabase } from "./supabase.js";

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 5;
const MAX_LENGTH = 30;
const VOTER_KEY = "omechu.voterId";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND_TEXT = "투표를 찾을 수 없어요. 링크가 맞는지 확인해 주세요.";
const EXPIRED_TEXT = "이 투표는 마감됐어요.";
const SAVE_FAILED_TEXT = "투표를 저장하지 못했어요. 잠시 후 다시 눌러 주세요.";

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
const createButton = document.getElementById("createButton");
const createMessage = document.getElementById("createMessage");
const deadline = document.getElementById("deadline");
const optionList = document.getElementById("optionList");
const pollMessage = document.getElementById("pollMessage");
const refreshButton = document.getElementById("refreshButton");
const shareButton = document.getElementById("shareButton");
const noticeText = document.getElementById("noticeText");

const params = new URLSearchParams(location.search);
const voter = readVoter();
let draft = parseMenus(params.get("menus"));
let poll = null;
let results = new Map();
let myVote = null;
let deadlineTimer = null;
let shareTimer = null;

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
		setMessage(createMessage, "후보는 5개까지예요.", true);
		return;
	}
	draft = [...draft, name];
	optionInput.value = "";
	renderDraft();
});

createButton.addEventListener("click", async () => {
	if (draft.length < MIN_OPTIONS) {
		return;
	}
	createButton.disabled = true;
	createButton.textContent = "만드는 중…";
	setMessage(createMessage, "", false);
	try {
		const supabase = await requireSupabase();
		const { data, error } = await supabase
			.from("menu_polls")
			.insert({ options: draft })
			.select("id, options, expires_at")
			.single();
		if (error) {
			throw error;
		}
		history.replaceState(null, "", location.pathname + "?id=" + data.id);
		showPoll(data);
		await refreshResults();
	} catch (error) {
		console.error(error);
		setMessage(createMessage, "투표를 만들지 못했어요. 잠시 후 다시 눌러 주세요.", true);
	} finally {
		createButton.disabled = draft.length < MIN_OPTIONS;
		createButton.textContent = "투표 만들기";
	}
});

refreshButton.addEventListener("click", () => {
	setMessage(pollMessage, "", false);
	refreshResults();
});

// 휴대폰은 기본 공유 창(카톡 등)을 열고, 공유 창이 없거나 열지 못하는 브라우저에서는 링크를 복사해요.
shareButton.addEventListener("click", async () => {
	const url = location.origin + location.pathname + "?id=" + poll.id;
	const text = "오늘 뭐 먹을까요? 후보: " + poll.options.join(", ");
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
	try {
		const supabase = await requireSupabase();
		const { data, error } = await supabase
			.from("menu_polls")
			.select("id, options, expires_at")
			.eq("id", id)
			.maybeSingle();
		if (error) {
			throw error;
		}
		if (!data) {
			showNotice(NOT_FOUND_TEXT);
			return;
		}
		if (isExpired(data)) {
			showNotice(EXPIRED_TEXT);
			return;
		}
		showPoll(data);
		await refreshResults();
	} catch (error) {
		console.error(error);
		showNotice("투표를 불러오지 못했어요. 잠시 후 새로고침해 주세요.");
	}
}

function showPoll(data) {
	poll = data;
	results = new Map();
	myVote = null;
	renderOptions();
	renderDeadline();
	clearInterval(deadlineTimer);
	deadlineTimer = setInterval(renderDeadline, 60_000);
	show("poll");
}

async function refreshResults() {
	refreshButton.disabled = true;
	try {
		const supabase = await requireSupabase();
		const [countsResult, mineResult] = await Promise.all([
			supabase.rpc("menu_poll_results", { p_poll: poll.id }),
			supabase
				.from("menu_poll_votes")
				.select("option_index")
				.eq("poll_id", poll.id)
				.eq("voter", voter)
				.maybeSingle(),
		]);
		if (countsResult.error) {
			throw countsResult.error;
		}
		if (mineResult.error) {
			throw mineResult.error;
		}
		results = new Map(countsResult.data.map((row) => [row.option_index, Number(row.votes)]));
		myVote = mineResult.data ? mineResult.data.option_index : null;
		renderOptions();
		renderDeadline();
	} catch (error) {
		console.error(error);
		setMessage(pollMessage, "결과를 불러오지 못했어요. 잠시 후 다시 눌러 주세요.", true);
	} finally {
		refreshButton.disabled = false;
	}
}

async function vote(index) {
	setMessage(pollMessage, "", false);
	setOptionsDisabled(true);
	try {
		const supabase = await requireSupabase();
		const { error } = await supabase
			.from("menu_poll_votes")
			.insert({ poll_id: poll.id, voter, option_index: index });
		if (!error) {
			myVote = index;
			setMessage(pollMessage, "투표했어요.", false);
		} else if (error.code === "23505") {
			setMessage(pollMessage, "이미 투표했어요.", false);
		} else if (error.code === "42501") {
			// DB 정책이 막은 경우는 보통 마감이에요. 마감 시각을 다시 읽어서 안내해요.
			const { data } = await supabase.from("menu_polls").select("expires_at").eq("id", poll.id).maybeSingle();
			if (!data || isExpired(data)) {
				showNotice(EXPIRED_TEXT);
				return;
			}
			setMessage(pollMessage, SAVE_FAILED_TEXT, true);
		} else {
			throw error;
		}
		await refreshResults();
	} catch (error) {
		console.error(error);
		setMessage(pollMessage, SAVE_FAILED_TEXT, true);
	} finally {
		setOptionsDisabled(false);
	}
}

function renderDraft() {
	optionCount.textContent = String(draft.length);
	optionChips.replaceChildren(...draft.map(chip));
	const full = draft.length >= MAX_OPTIONS;
	optionInput.disabled = full;
	addButton.disabled = full;
	createButton.disabled = draft.length < MIN_OPTIONS;
	if (draft.length < MIN_OPTIONS) {
		setMessage(createMessage, "후보를 2개 이상 넣어 주세요.", false);
	} else if (full) {
		setMessage(createMessage, "후보는 5개까지예요.", false);
	} else {
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

function renderOptions() {
	const counts = poll.options.map((_, index) => results.get(index) ?? 0);
	const total = counts.reduce((sum, count) => sum + count, 0);
	const top = Math.max(...counts);
	optionList.replaceChildren(...poll.options.map((name, index) =>
		optionRow(name, index, counts[index], total, total > 0 && counts[index] === top)));
}

function optionRow(name, index, count, total, isLeader) {
	const item = document.createElement("li");
	const button = document.createElement("button");
	button.type = "button";
	button.className = "vote-option" + (isLeader ? " is-leader" : "");
	button.setAttribute("aria-pressed", String(myVote === index));
	button.style.setProperty("--ratio", total > 0 ? (count / total).toFixed(3) : "0");
	const label = document.createElement("span");
	label.className = "vote-option-name";
	label.textContent = name;
	if (myVote === index) {
		const mine = document.createElement("span");
		mine.className = "visually-hidden";
		mine.textContent = " (내 선택)";
		label.append(mine);
	}
	const countText = document.createElement("span");
	countText.className = "vote-option-count";
	countText.textContent = total > 0 ? count + "표 · " + Math.round(count / total * 100) + "%" : "0표";
	const bar = document.createElement("span");
	bar.className = "vote-option-bar";
	button.append(label, countText, bar);
	button.addEventListener("click", () => vote(index));
	item.append(button);
	if (isLeader) {
		const link = document.createElement("a");
		link.className = "vote-leader-link";
		link.href = "index.html";
		link.textContent = "근처 식당 찾으러 가기";
		item.append(link);
	}
	return item;
}

function renderDeadline() {
	const remaining = new Date(poll.expires_at) - Date.now();
	if (remaining <= 0) {
		showNotice(EXPIRED_TEXT);
		return;
	}
	deadline.textContent = formatRemaining(remaining);
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

function isExpired(data) {
	return new Date(data.expires_at) <= Date.now();
}

function setOptionsDisabled(disabled) {
	for (const button of optionList.querySelectorAll(".vote-option")) {
		button.disabled = disabled;
	}
}

function flashShareLabel(label) {
	shareButton.textContent = label;
	clearTimeout(shareTimer);
	shareTimer = setTimeout(() => {
		shareButton.textContent = "링크 공유하기";
	}, 2000);
}

function showNotice(text) {
	clearInterval(deadlineTimer);
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

// 같은 브라우저가 한 투표에 한 표만 넣을 수 있게, 이 기기에 무작위 글자열을 만들어 두고 투표마다 같이 보내요.
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
