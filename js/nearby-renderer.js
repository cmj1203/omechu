import { placeNameLink } from "./place-page.js";
import { MIN_REVIEWS, omechuRating } from "./place-rating.js";
import { getSupabase } from "./supabase.js";

// 경고(⚠) 단추로 알린 가게는 이 기기에 기억해 두고, 다음에 그려도 '알렸어요'로 꺼진 채 보여 줘요.
const REPORTED_KEY = "omechu.reportedPlaces";
const reported = readReported();
// 값은 closure_reports.reason 에 그대로 들어가요(관리자 화면이 같은 값으로 읽어요).
const REPORT_REASONS = [
	["closed", "문 닫았어요"],
	["no_info", "정보가 없어요"],
	["not_found", "찾을 수 없어요"],
];
const REPORT_LABEL = "가게 문제 알리기";
let reportDialog = null;
let placeDialog = null;

export function similarLabel(menu) {
	if (menu.kinds.includes("식사")) {
		return menu.cuisine === "아시아" ? "아시아 음식점" : menu.cuisine + "당";
	}
	if (menu.kinds.includes("간식")) {
		return "카페·디저트 가게";
	}
	return "술집";
}

// 아래에 다른 가게 목록이 있으면 그 제목줄의 경고 단추로 이 가게도 알리니까, 상자에는 단추를 두지 않아요.
export function restaurantCard(restaurant, origin, withReport = true) {
	const card = document.createElement("div");
	card.className = "restaurant-card";
	card.append(
		paragraph("restaurant-label", "추천 식당" + (restaurant.menuName ? " · " + restaurant.menuName : "")),
	);
	const name = paragraph("restaurant-name", "");
	name.append(placeNameLink(restaurant));
	card.append(name);
	if (restaurant.officialVisits) {
		card.append(officialBadge(restaurant.officialVisits));
	}
	if (restaurant.googleRating !== undefined) {
		const rating = paragraph("restaurant-rating", "오메추 평점 " + ratingText(restaurant.googleRating));
		rating.title = ratingTitle(restaurant.googleRating);
		if (omechuRating(restaurant.googleRating) !== null) {
			rating.append(phrase(" · 구글 " + restaurant.googleRating.rating.toFixed(1) + " · 리뷰\u00a0" + restaurant.googleRating.reviews.toLocaleString("ko-KR")));
		}
		card.append(rating);
	}
	card.append(
		// '분'과 '·' 사이는 줄바꿈 없는 공백이라, 좁은 화면에서는 · 뒤에서만 줄이 바뀌어요.
		paragraph("restaurant-walk", origin.label + "에서 도보 약 " + restaurant.walkMinutes + "분\u00a0· " + formatDistance(restaurant.distance)),
	);
	const info = [restaurant.address, restaurant.phone].filter(Boolean).join(" · ");
	if (info) {
		card.append(paragraph("restaurant-info", info));
	}
	const links = document.createElement("p");
	links.className = "restaurant-links";
	links.append(
		link("카카오맵 길찾기 ↗", kakaoRouteUrl(origin, restaurant)),
		link("지도에서 보기 ↗", kakaoMapUrl(restaurant)),
		shareButton(restaurant, origin),
	);
	if (withReport) {
		links.append(reportButton(restaurant));
	}
	card.append(links);
	return card;
}

// 경고 단추는 가게마다 두지 않고 제목줄 오른쪽 끝에 하나만 두어요. reportable 은 그 단추로 고를 수 있는 가게예요.
export function othersList(restaurants, title, reportable = restaurants) {
	const wrapper = document.createElement("div");
	wrapper.className = "others";
	const heading = paragraph("others-title", "");
	heading.append(phrase(title), listReportButton(reportable));
	wrapper.append(heading);
	const list = document.createElement("ol");
	for (const restaurant of restaurants) {
		const item = document.createElement("li");
		const time = document.createElement("span");
		time.textContent = "도보 약 " + restaurant.walkMinutes + "분 · " + formatDistance(restaurant.distance);
		item.append(placeNameLink(restaurant));
		if (restaurant.menuName) {
			const tag = document.createElement("em");
			tag.className = "menu-tag";
			tag.textContent = restaurant.menuName;
			item.append(tag);
		}
		if (restaurant.officialVisits) {
			item.append(officialBadge(restaurant.officialVisits));
		}
		if (restaurant.googleRating !== undefined) {
			item.append(ratingTag(restaurant.googleRating));
		}
		item.append(time);
		list.append(item);
	}
	wrapper.append(list);
	return wrapper;
}

// 오메추 평점(리뷰 수를 반영한 구글 평점)은 리뷰가 MIN_REVIEWS 개 이상일 때만 보여 주고, 평점이 없거나 리뷰가 적으면 '-'로 보여 줘요.
// 평점을 묻지 못한 가게(구글 키 없음·오류)에는 아무것도 붙이지 않아요.
function ratingText(found) {
	const rating = omechuRating(found);
	return rating === null ? "-" : rating.toFixed(1);
}

function ratingTag(found) {
	const tag = document.createElement("em");
	tag.className = "rating-tag";
	tag.textContent = "★\u00a0" + ratingText(found);
	tag.title = ratingTitle(found);
	return tag;
}

function ratingTitle(found) {
	if (!found) {
		return "구글 평점이 없어요";
	}
	if (omechuRating(found) === null) {
		return "구글 리뷰가 " + MIN_REVIEWS + "개보다 적어서(" + found.reviews + "개) 평점을 쓰지 않아요";
	}
	return "오메추 평점 " + ratingText(found) + " (구글 " + found.rating.toFixed(1) + " · 리뷰 " + found.reviews.toLocaleString("ko-KR") + "개, 리뷰가 적을수록 4.0 쪽으로 당겨 셈)";
}

// 서울시청 업무추진비로 최근 2년 동안 결제한 횟수예요. 누르면 공무원 맛집 탭으로 가요.
function officialBadge(visits) {
	const badge = document.createElement("a");
	badge.className = "official-badge";
	badge.href = "official.html";
	badge.textContent = "공무원 단골 · " + visits + "번";
	badge.title = "서울시청 업무추진비로 최근 2년 동안 " + visits + "번 결제한 곳이에요";
	return badge;
}

// withRatings 면 구글 평점 출처를 같이 적어요.
export function footer(menu, where, withRatings = false) {
	const note = document.createElement("p");
	note.className = "nearby-footer";
	const osm = document.createElement("a");
	osm.href = "https://www.openstreetmap.org/copyright";
	osm.target = "_blank";
	osm.rel = "noopener";
	osm.textContent = "OpenStreetMap";
	// 세 구절을 따로 묶어서 좁은 화면에서는 · 뒤에서만 줄이 바뀌어요.
	// © 뒤와 ↗ 앞은 줄바꿈 없는 공백이라 ©와 ↗만 따로 떨어지지 않아요.
	note.append(
		phrase("도보 시간은 직선거리로 어림한 값이에요 ·"),
		" ",
		phrase("식당 정보 ©\u00a0", osm, " 기여자 ·"),
		" ",
		...(withRatings ? [phrase("평점 ©\u00a0Google ·"), " "] : []),
		phrase(link("구글 지도에서 더 찾기\u00a0↗", googleMapsUrl(menu, where))),
	);
	return note;
}

function phrase(...parts) {
	const span = document.createElement("span");
	span.append(...parts);
	return span;
}

function kakaoMapUrl(restaurant) {
	return "https://map.kakao.com/link/map/" + kakaoLabel(restaurant.name) + "," + restaurant.lat + "," + restaurant.lng;
}

function kakaoRouteUrl(origin, restaurant) {
	return "https://map.kakao.com/link/from/" + kakaoLabel(origin.label) + "," + origin.lat + "," + origin.lng
		+ "/to/" + kakaoLabel(restaurant.name) + "," + restaurant.lat + "," + restaurant.lng;
}

function kakaoLabel(text) {
	return encodeURIComponent(text.replace(/,/g, " "));
}

function googleMapsUrl(menu, where) {
	const base = "https://www.google.com/maps/search/";
	if (typeof where === "object" && where !== null) {
		return base + encodeURIComponent(menu.name) + "/@" + where.lat.toFixed(6) + "," + where.lng.toFixed(6) + ",16z";
	}
	return base + encodeURIComponent(where ? where + " " + menu.name : menu.name);
}

function formatDistance(meters) {
	return meters < 1000 ? meters + "m" : (meters / 1000).toFixed(1) + "km";
}

export function paragraph(className, text) {
	const element = document.createElement("p");
	element.className = className;
	element.textContent = text;
	return element;
}

// 휴대폰은 기본 공유 창(카톡 등)을 열고, 공유 창이 없거나 열지 못하는 브라우저에서는 내용을 복사해요.
function shareButton(restaurant, origin) {
	const button = document.createElement("button");
	button.type = "button";
	button.textContent = "공유하기";
	let labelTimer = null;
	// 바뀐 글자는 2초 뒤 '공유하기'로 돌아가요. 빨리 두 번 누르면 마지막에 누른 때부터 2초를 세요.
	const flashLabel = (label) => {
		button.textContent = label;
		clearTimeout(labelTimer);
		labelTimer = setTimeout(() => {
			button.textContent = "공유하기";
		}, 2000);
	};
	button.addEventListener("click", async () => {
		const url = kakaoMapUrl(restaurant);
		// '현재 위치'라고 보내면 받는 사람이 자기 위치로 읽어서, 보내는 사람 기준인 '내 위치'로 써요.
		const from = origin.label === "현재 위치" ? "내 위치" : origin.label;
		const text = (restaurant.menuName ? "오늘 메뉴는 " + restaurant.menuName + "! " : "오늘은 여기 어때? ")
			+ restaurant.name + " (" + from + "에서 도보 약 " + restaurant.walkMinutes + "분)";
		if (navigator.share) {
			try {
				await navigator.share({ title: "오메추 추천", text, url });
				return;
			} catch (error) {
				if (error.name === "AbortError") {
					return;
				}
			}
		}
		try {
			await navigator.clipboard.writeText(text + "\n" + url);
			flashLabel("복사했어요");
		} catch {
			flashLabel("공유하지 못했어요");
		}
	});
	return button;
}

// 경고(⚠) 단추. 누르면 사유를 고르는 창이 열리고, 고르면 확인 없이 바로 보내요.
// 보낸 가게는 이 기기에서 '알렸어요'로 꺼져 있어요.
function reportButton(restaurant) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "report-button";
	const key = reportKey(restaurant);
	if (reported.has(key)) {
		markReported(button);
		return button;
	}
	showReportIcon(button);
	button.addEventListener("click", async () => {
		const reason = await chooseReportReason(restaurant.name);
		if (!reason) {
			return;
		}
		// 보내는 동안 꺼 두어 두 번 눌러도 알림이 두 개 쌓이지 않아요.
		button.disabled = true;
		if (await sendReport(restaurant, reason)) {
			reported.add(key);
			saveReported();
			markReported(button);
			return;
		}
		// 2초 동안 실패를 보여 주고 다시 누를 수 있게 돌려요.
		showReportText(button, "알리지 못했어요");
		setTimeout(() => {
			showReportIcon(button);
			button.disabled = false;
		}, 2000);
	});
	return button;
}

// 목록 제목줄의 경고 단추. 가게를 고르고 사유를 고르면 보내고, 2초 동안 결과를 보여 준 뒤 아이콘으로 돌아와요.
// 한 목록에서 여러 가게를 알릴 수 있어서 단추는 꺼 두지 않고, 알린 가게만 가게 고르는 창에서 꺼져 있어요.
function listReportButton(restaurants) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "report-button text-button";
	showReportIcon(button);
	button.addEventListener("click", async () => {
		const restaurant = await chooseReportPlace(restaurants);
		if (!restaurant) {
			return;
		}
		const reason = await chooseReportReason(restaurant.name);
		if (!reason) {
			return;
		}
		button.disabled = true;
		const sent = await sendReport(restaurant, reason);
		if (sent) {
			reported.add(reportKey(restaurant));
			saveReported();
		}
		showReportText(button, sent ? "알렸어요" : "알리지 못했어요");
		setTimeout(() => {
			showReportIcon(button);
			button.disabled = false;
		}, 2000);
	});
	return button;
}

// 글자가 없는 단추에만 CSS가 삼각형 아이콘을 그려요(.report-button:empty).
function showReportIcon(button) {
	button.textContent = "";
	button.setAttribute("aria-label", REPORT_LABEL);
	button.title = REPORT_LABEL;
}

function showReportText(button, text) {
	button.removeAttribute("aria-label");
	button.removeAttribute("title");
	button.textContent = text;
}

function markReported(button) {
	showReportText(button, "알렸어요");
	button.disabled = true;
}

// 사유 창은 한 번만 만들어 두고 다시 써요. 고른 사유 값을, 취소·Esc·바깥 누르기면 빈 글자를 돌려줘요.
function chooseReportReason(name) {
	reportDialog ??= createReportDialog("reportDialogTitle", REPORT_REASONS.map(([value, label]) => dialogButton(label, value)));
	reportDialog.querySelector(".report-dialog-title").textContent = name;
	return askDialog(reportDialog);
}

// 가게 고르는 창. 고른 가게를, 취소·Esc·바깥 누르기면 null 을 돌려줘요. 이미 알린 가게는 꺼져 있어요.
async function chooseReportPlace(restaurants) {
	placeDialog ??= createReportDialog("reportPlaceTitle", []);
	placeDialog.querySelector(".report-dialog-title").textContent = "어느 가게예요?";
	placeDialog.querySelector(".report-reasons").replaceChildren(...restaurants.map((restaurant, index) => {
		const done = reported.has(reportKey(restaurant));
		const button = dialogButton(restaurant.name + (done ? " · 알렸어요" : ""), String(index));
		button.disabled = done;
		return button;
	}));
	const picked = await askDialog(placeDialog);
	return picked === "" ? null : restaurants[Number(picked)];
}

function askDialog(dialog) {
	dialog.returnValue = "";
	dialog.showModal();
	// 열자마자 초점을 제목에 두어, 첫 단추에 테두리가 생겨 골라 둔 것처럼 보이지 않게 해요(사파리).
	dialog.querySelector(".report-dialog-title").focus();
	return new Promise((resolve) => {
		dialog.addEventListener("close", () => resolve(dialog.returnValue), { once: true });
	});
}

function createReportDialog(titleId, choices) {
	const dialog = document.createElement("dialog");
	dialog.className = "report-dialog";
	dialog.setAttribute("aria-labelledby", titleId);
	const form = document.createElement("form");
	form.method = "dialog";
	const title = paragraph("report-dialog-title", "");
	title.id = titleId;
	title.tabIndex = -1;
	const reasons = document.createElement("div");
	reasons.className = "report-reasons";
	reasons.append(...choices);
	const cancel = dialogButton("취소", "");
	cancel.className = "text-button";
	form.append(title, reasons, cancel);
	dialog.append(form);
	// 창 안쪽 여백은 form 에 있어서, dialog 자신이 눌렸으면 바깥(어두운 곳)을 누른 거예요.
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) {
			dialog.close("");
		}
	});
	document.body.append(dialog);
	return dialog;
}

function dialogButton(label, value) {
	const button = document.createElement("button");
	button.value = value;
	button.textContent = label;
	return button;
}

async function sendReport(restaurant, reason) {
	try {
		const supabase = await getSupabase();
		if (!supabase) {
			return false;
		}
		const { error } = await supabase.from("closure_reports").insert({
			name: restaurant.name,
			address: restaurant.address || null,
			lat: restaurant.lat,
			lng: restaurant.lng,
			reason,
		});
		if (error) {
			throw error;
		}
		return true;
	} catch (error) {
		console.warn("가게 알림을 보내지 못했어요.", error);
		return false;
	}
}

// 검색 결과에는 가게 번호(osm_id)가 없어서 이름과 좌표로 같은 가게를 알아봐요.
function reportKey(restaurant) {
	return restaurant.name + "|" + restaurant.lat + "|" + restaurant.lng;
}

function readReported() {
	try {
		const saved = JSON.parse(localStorage.getItem(REPORTED_KEY) ?? "[]");
		return new Set(Array.isArray(saved) ? saved.filter((key) => typeof key === "string") : []);
	} catch {
		return new Set();
	}
}

function saveReported() {
	try {
		localStorage.setItem(REPORTED_KEY, JSON.stringify([...reported]));
	} catch {
		// 저장이 막힌 브라우저(사생활 보호 모드 등)에서는 이 화면을 연 동안만 기억해요.
	}
}

function link(text, href) {
	const anchor = document.createElement("a");
	anchor.href = href;
	anchor.target = "_blank";
	anchor.rel = "noopener";
	anchor.textContent = text;
	return anchor;
}
