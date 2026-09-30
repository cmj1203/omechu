import { getSupabase, SUPABASE_CONFIGURED } from "./supabase.js";

const notice = document.getElementById("adminNotice");
const loginForm = document.getElementById("loginForm");
const loginMessage = document.getElementById("loginMessage");
const manager = document.getElementById("manager");
const whoami = document.getElementById("whoami");
const menuForm = document.getElementById("menuForm");
const formTitle = document.getElementById("formTitle");
const saveButton = document.getElementById("saveBtn");
const cancelButton = document.getElementById("cancelEdit");
const formMessage = document.getElementById("formMessage");
const menuRows = document.getElementById("menuRows");
const menuCount = document.getElementById("menuCount");

let supabase = null;
let editingId = null;

if (!SUPABASE_CONFIGURED) {
	showNotice("아직 Supabase가 연결되지 않았어요. js/supabase.js 에 프로젝트 주소와 공개 키를 넣어 주세요.");
} else {
	try {
		supabase = await getSupabase();
		const { data } = await supabase.auth.getSession();
		if (data.session) {
			await openManager(data.session.user);
		} else {
			loginForm.hidden = false;
		}
	} catch (error) {
		showNotice("Supabase에 연결하지 못했어요: " + error.message);
	}
}

loginForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const { email, password } = Object.fromEntries(new FormData(loginForm));
	setMessage(loginMessage, "로그인 중…");
	const { data, error } = await supabase.auth.signInWithPassword({ email, password });
	if (error) {
		setMessage(loginMessage, "이메일이나 비밀번호가 맞지 않아요.", true);
		return;
	}
	setMessage(loginMessage, "");
	await openManager(data.user);
});

document.getElementById("logout").addEventListener("click", async () => {
	await supabase.auth.signOut();
	manager.hidden = true;
	resetForm();
	loginForm.reset();
	loginForm.hidden = false;
});

menuForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const fields = new FormData(menuForm);
	const record = {
		name: fields.get("name").trim(),
		kind: fields.get("kind"),
		cuisine: fields.get("cuisine"),
		party: fields.getAll("party"),
		times: fields.getAll("times"),
		search_terms: commaList(fields.get("search_terms")),
		exclude_terms: commaList(fields.get("exclude_terms")),
	};
	if (!record.name || record.party.length === 0 || record.times.length === 0) {
		setMessage(formMessage, "이름을 적고, 인원과 시간을 하나 이상 골라 주세요.", true);
		return;
	}

	saveButton.disabled = true;
	const adding = editingId === null;
	const { error } = adding
		? await supabase.from("menus").insert(record)
		: await supabase.from("menus").update(record).eq("id", editingId);
	saveButton.disabled = false;
	if (error) {
		setMessage(formMessage, error.code === "23505" ? "이미 있는 메뉴 이름이에요." : "저장하지 못했어요: " + error.message, true);
		return;
	}
	resetForm();
	setMessage(formMessage, (adding ? "추가했어요: " : "수정했어요: ") + record.name);
	await refreshList();
});

cancelButton.addEventListener("click", () => {
	resetForm();
	setMessage(formMessage, "");
});

async function openManager(user) {
	const { data: adminRow, error } = await supabase
		.from("admins")
		.select("user_id")
		.eq("user_id", user.id)
		.maybeSingle();
	if (error || !adminRow) {
		await supabase.auth.signOut();
		loginForm.hidden = false;
		setMessage(loginMessage, "관리자 권한이 없는 계정이에요.", true);
		return;
	}
	loginForm.hidden = true;
	manager.hidden = false;
	whoami.textContent = user.email + " 로 로그인했어요";
	await refreshList();
}

async function refreshList() {
	const { data, error } = await supabase
		.from("menus")
		.select("id, name, kind, cuisine, party, times, search_terms, exclude_terms")
		.order("kind")
		.order("cuisine")
		.order("name");
	if (error) {
		menuCount.textContent = "";
		const row = document.createElement("tr");
		const cell = textCell("메뉴를 불러오지 못했어요: " + error.message);
		cell.colSpan = 8;
		row.append(cell);
		menuRows.replaceChildren(row);
		return;
	}
	menuCount.textContent = "(" + data.length + "개)";
	menuRows.replaceChildren(...data.map(menuRow));
}

function menuRow(menu) {
	const actions = document.createElement("td");
	actions.append(
		actionButton("수정", "small", () => startEdit(menu)),
		" ",
		actionButton("삭제", "small danger", () => removeMenu(menu)),
	);
	const row = document.createElement("tr");
	row.append(
		textCell(menu.name),
		textCell(menu.kind),
		textCell(menu.cuisine),
		textCell(menu.party.join("·")),
		textCell(menu.times.join("·")),
		textCell(menu.search_terms.join(", "), "terms"),
		textCell(menu.exclude_terms.join(", "), "terms"),
		actions,
	);
	return row;
}

function startEdit(menu) {
	editingId = menu.id;
	menuForm.elements.namedItem("name").value = menu.name;
	menuForm.elements.namedItem("kind").value = menu.kind;
	menuForm.elements.namedItem("cuisine").value = menu.cuisine;
	menuForm.elements.namedItem("search_terms").value = menu.search_terms.join(", ");
	menuForm.elements.namedItem("exclude_terms").value = menu.exclude_terms.join(", ");
	for (const box of menuForm.querySelectorAll("input[name='party']")) {
		box.checked = menu.party.includes(box.value);
	}
	for (const box of menuForm.querySelectorAll("input[name='times']")) {
		box.checked = menu.times.includes(box.value);
	}
	formTitle.textContent = "메뉴 수정: " + menu.name;
	saveButton.textContent = "저장";
	cancelButton.hidden = false;
	setMessage(formMessage, "");
	menuForm.scrollIntoView({ behavior: "smooth" });
}

function resetForm() {
	editingId = null;
	menuForm.reset();
	formTitle.textContent = "메뉴 추가";
	saveButton.textContent = "추가";
	cancelButton.hidden = true;
}

async function removeMenu(menu) {
	if (!confirm("'" + menu.name + "' 메뉴를 삭제할까요?")) {
		return;
	}
	const { error } = await supabase.from("menus").delete().eq("id", menu.id);
	if (error) {
		setMessage(formMessage, "삭제하지 못했어요: " + error.message, true);
		return;
	}
	if (editingId === menu.id) {
		resetForm();
	}
	setMessage(formMessage, "삭제했어요: " + menu.name);
	await refreshList();
}

function commaList(text) {
	return text.split(",").map((term) => term.trim()).filter(Boolean);
}

function textCell(text, className = "") {
	const cell = document.createElement("td");
	cell.className = className;
	cell.textContent = text;
	return cell;
}

function actionButton(label, className, onClick) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = className;
	button.textContent = label;
	button.addEventListener("click", onClick);
	return button;
}

function setMessage(element, text, isError = false) {
	element.textContent = text;
	element.classList.toggle("error", isError);
}

function showNotice(text) {
	notice.textContent = text;
	notice.hidden = false;
}
