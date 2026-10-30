import { excludedMenus, listFavorites, listRecent, setExcluded, setFavorite } from "./member.js";
import { loadMenus } from "./menus.js";
import { getSupabase, SUPABASE_CONFIGURED } from "./supabase.js";

// 내 계정: 로그인·회원가입, 즐겨찾기·최근 본 가게, 로그아웃·탈퇴. 관리자 계정이면 관리자 화면 링크도 보여 줘요.
const notice = document.getElementById("accountNotice");
const authBox = document.getElementById("authBox");
const loginTab = document.getElementById("loginTab");
const signupTab = document.getElementById("signupTab");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const loginMessage = document.getElementById("loginMessage");
const signupMessage = document.getElementById("signupMessage");
const memberBox = document.getElementById("memberBox");
const whoami = document.getElementById("whoami");
const adminLink = document.getElementById("adminLink");
const favoriteList = document.getElementById("favoriteList");
const favoriteCount = document.getElementById("favoriteCount");
const favoriteEmpty = document.getElementById("favoriteEmpty");
const recentList = document.getElementById("recentList");
const recentEmpty = document.getElementById("recentEmpty");
const excludeForm = document.getElementById("excludeForm");
const excludeSelect = document.getElementById("excludeSelect");
const excludedList = document.getElementById("excludedList");
const excludedCount = document.getElementById("excludedCount");
const excludedEmpty = document.getElementById("excludedEmpty");

const MIN_PASSWORD = 8;

let supabase = null;
let menuNames = [];

if (!SUPABASE_CONFIGURED) {
	showNotice("아직 Supabase가 연결되지 않았어요.");
} else {
	try {
		supabase = await getSupabase();
		const { data } = await supabase.auth.getSession();
		if (data.session) {
			await openMember(data.session.user);
		} else {
			showAuth(new URLSearchParams(location.search).get("tab") === "signup");
		}
	} catch (error) {
		showNotice("Supabase에 연결하지 못했어요: " + error.message);
	}
}

loginTab.addEventListener("click", () => showAuth(false));
signupTab.addEventListener("click", () => showAuth(true));

loginForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const { email, password } = Object.fromEntries(new FormData(loginForm));
	setMessage(loginMessage, "로그인 중…");
	const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
	if (error) {
		setMessage(loginMessage, error.code === "email_not_confirmed"
			? "메일함에서 가입 확인 링크를 먼저 눌러 주세요."
			: "이메일이나 비밀번호가 맞지 않아요.", true);
		return;
	}
	setMessage(loginMessage, "");
	await openMember(data.user);
});

signupForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const { email, password, confirm } = Object.fromEntries(new FormData(signupForm));
	if (password.length < MIN_PASSWORD) {
		setMessage(signupMessage, "비밀번호는 " + MIN_PASSWORD + "자 이상으로 정해 주세요.", true);
		return;
	}
	if (password !== confirm) {
		setMessage(signupMessage, "비밀번호 확인이 달라요.", true);
		return;
	}
	setMessage(signupMessage, "가입하는 중…");
	const { data, error } = await supabase.auth.signUp({
		email: email.trim(),
		password,
		options: { emailRedirectTo: new URL("account.html", location.href).href },
	});
	if (error) {
		setMessage(signupMessage, signupError(error), true);
		return;
	}
	// 가입 확인 메일을 쓰는 프로젝트면 세션 없이 돌아와요. 바로 로그인되는 설정이면 내 계정을 열어요.
	if (!data.session) {
		signupForm.reset();
		setMessage(signupMessage, email.trim() + " 으로 확인 메일을 보냈어요. 메일의 링크를 누르면 가입이 끝나요.");
		return;
	}
	setMessage(signupMessage, "");
	await openMember(data.user);
});

document.getElementById("logout").addEventListener("click", async () => {
	await supabase.auth.signOut();
	memberBox.hidden = true;
	loginForm.reset();
	showAuth(false);
});

document.getElementById("deleteAccount").addEventListener("click", async () => {
	if (!confirm("탈퇴하면 즐겨찾기와 최근 본 가게가 모두 지워지고 되돌릴 수 없어요. 탈퇴할까요?")) {
		return;
	}
	const { error } = await supabase.rpc("delete_my_account");
	if (error) {
		alert("탈퇴하지 못했어요: " + error.message);
		return;
	}
	await supabase.auth.signOut();
	memberBox.hidden = true;
	showAuth(false);
	setMessage(loginMessage, "탈퇴했어요. 그동안 고마웠어요.");
});

function showAuth(signup) {
	authBox.hidden = false;
	loginForm.hidden = signup;
	signupForm.hidden = !signup;
	loginTab.setAttribute("aria-selected", String(!signup));
	signupTab.setAttribute("aria-selected", String(signup));
}

async function openMember(user) {
	authBox.hidden = true;
	memberBox.hidden = false;
	whoami.textContent = user.email;
	const [{ data: admin }] = await Promise.all([
		supabase.from("admins").select("user_id").eq("user_id", user.id).maybeSingle(),
		refreshLists(),
		refreshExcluded(),
	]);
	adminLink.hidden = !admin;
}

// 기본으로 뺄 메뉴: 목록과, 아직 안 넣은 메뉴만 든 고르기 칸
async function refreshExcluded() {
	try {
		if (menuNames.length === 0) {
			menuNames = (await loadMenus()).menus.map((menu) => menu.name).sort((a, b) => a.localeCompare(b, "ko"));
		}
		const names = [...(await excludedMenus()) ?? []];
		excludedCount.textContent = names.length > 0 ? "(" + names.length + "개)" : "";
		excludedEmpty.hidden = names.length > 0;
		excludedList.replaceChildren(...names.map(menuItem));
		excludeSelect.replaceChildren(...menuNames.filter((name) => !names.includes(name)).map((name) => new Option(name)));
	} catch (error) {
		showNotice("기본으로 뺄 메뉴를 불러오지 못했어요: " + error.message);
	}
}

excludeForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const name = excludeSelect.value;
	if (!name) {
		return;
	}
	excludeForm.querySelector("button").disabled = true;
	try {
		await setExcluded(name, true);
		await refreshExcluded();
	} catch (error) {
		showNotice("기본으로 뺄 메뉴에 넣지 못했어요: " + error.message);
	} finally {
		excludeForm.querySelector("button").disabled = false;
	}
});

function menuItem(name) {
	const item = document.createElement("li");
	const text = document.createElement("span");
	text.className = "place-name";
	text.textContent = name;
	const button = document.createElement("button");
	button.type = "button";
	button.className = "small";
	button.textContent = "빼기";
	button.addEventListener("click", async () => {
		button.disabled = true;
		try {
			await setExcluded(name, false);
			await refreshExcluded();
		} catch (error) {
			button.disabled = false;
			showNotice("기본으로 뺄 메뉴에서 빼지 못했어요: " + error.message);
		}
	});
	item.append(text, button);
	return item;
}

async function refreshLists() {
	try {
		const [favorites, recent] = await Promise.all([listFavorites(supabase), listRecent(supabase)]);
		favoriteCount.textContent = favorites.length > 0 ? "(" + favorites.length + "곳)" : "";
		favoriteEmpty.hidden = favorites.length > 0;
		favoriteList.replaceChildren(...favorites.map((place) => placeItem(place, removeButton(place))));
		recentEmpty.hidden = recent.length > 0;
		recentList.replaceChildren(...recent.map((place) => placeItem(place, null, viewedLabel(place.viewed_at))));
	} catch (error) {
		showNotice("저장한 가게를 불러오지 못했어요: " + error.message);
	}
}

function placeItem(place, action, meta = "") {
	const item = document.createElement("li");
	const text = document.createElement("div");
	const name = document.createElement("a");
	name.className = "place-name";
	name.href = "https://map.kakao.com/link/map/" + encodeURIComponent(place.name.replace(/,/g, " ")) + "," + place.lat + "," + place.lng;
	name.target = "_blank";
	name.rel = "noopener";
	name.textContent = place.name + " ↗";
	text.append(name);
	const detail = [place.address, meta].filter(Boolean).join(" · ");
	if (detail) {
		const line = document.createElement("p");
		line.className = "place-address";
		line.textContent = detail;
		text.append(line);
	}
	item.append(text);
	if (action) {
		item.append(action);
	}
	return item;
}

function removeButton(place) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "small";
	button.textContent = "빼기";
	button.addEventListener("click", async () => {
		button.disabled = true;
		try {
			await setFavorite(place, false);
			await refreshLists();
		} catch (error) {
			button.disabled = false;
			showNotice("즐겨찾기에서 빼지 못했어요: " + error.message);
		}
	});
	return button;
}

function viewedLabel(viewedAt) {
	const date = new Date(viewedAt);
	return date.toLocaleDateString("ko-KR", { month: "long", day: "numeric" }) + " 봄";
}

function signupError(error) {
	if (error.code === "user_already_exists" || /already registered/i.test(error.message)) {
		return "이미 가입한 이메일이에요. 로그인해 주세요.";
	}
	if (error.code === "weak_password") {
		return "비밀번호가 너무 쉬워요. 다른 비밀번호로 정해 주세요.";
	}
	if (error.code === "signup_disabled") {
		return "지금은 회원가입을 받지 않고 있어요.";
	}
	if (error.status === 429) {
		return "잠시 후 다시 시도해 주세요.";
	}
	return "가입하지 못했어요: " + error.message;
}

function setMessage(element, text, isError = false) {
	element.textContent = text;
	element.classList.toggle("error", isError);
}

function showNotice(text) {
	notice.textContent = text;
	notice.hidden = false;
}
