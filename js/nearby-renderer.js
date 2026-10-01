export function similarLabel(menu) {
	if (menu.kind === "술") {
		return "술집";
	}
	if (menu.kind === "간식") {
		return "카페·디저트 가게";
	}
	return menu.cuisine === "아시아" ? "아시아 음식점" : menu.cuisine + "당";
}

export function restaurantCard(restaurant, origin) {
	const card = document.createElement("div");
	card.className = "restaurant-card";
	card.append(
		paragraph("restaurant-label", "추천 식당" + (restaurant.menuName ? " · " + restaurant.menuName : "")),
		paragraph("restaurant-name", restaurant.name),
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
	card.append(links);
	return card;
}

export function othersList(restaurants, title) {
	const wrapper = document.createElement("div");
	wrapper.className = "others";
	wrapper.append(paragraph("others-title", title));
	const list = document.createElement("ol");
	for (const restaurant of restaurants) {
		const item = document.createElement("li");
		const time = document.createElement("span");
		time.textContent = "도보 약 " + restaurant.walkMinutes + "분 · " + formatDistance(restaurant.distance);
		item.append(link(restaurant.name, kakaoMapUrl(restaurant)));
		if (restaurant.menuName) {
			const tag = document.createElement("em");
			tag.className = "menu-tag";
			tag.textContent = restaurant.menuName;
			item.append(tag);
		}
		item.append(time);
		list.append(item);
	}
	wrapper.append(list);
	return wrapper;
}

export function footer(menu, where) {
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

function link(text, href) {
	const anchor = document.createElement("a");
	anchor.href = href;
	anchor.target = "_blank";
	anchor.rel = "noopener";
	anchor.textContent = text;
	return anchor;
}
