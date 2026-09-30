const GEO_ERRORS = {
	1: "위치 권한이 꺼져 있어요. 주소창 왼쪽 아이콘에서 위치를 '허용'으로 바꾸거나, 위치 칸에 동네 이름을 적어 주세요.",
	2: "현재 위치를 알 수 없어요. 기기의 위치 서비스를 켜거나, 위치 칸에 동네 이름을 적어 주세요.",
	3: "위치를 확인하는 데 너무 오래 걸려요. 다시 누르거나, 위치 칸에 동네 이름을 적어 주세요.",
};

export function initNearby(section) {
	const button = section.querySelector("#nearbyBtn");
	const placeInput = section.querySelector("#nearbyPlace");
	const result = section.querySelector("#nearbyResult");
	let menu = "";

	button.addEventListener("click", findNearby);
	placeInput.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			findNearby();
		}
	});

	return {
		show(menuName) {
			menu = menuName;
			button.textContent = "📍 주변 '" + menuName + "' 맛집 찾기";
			result.replaceChildren();
			section.hidden = false;
		},
		hide() {
			section.hidden = true;
		},
	};

	async function findNearby() {
		if (button.disabled) {
			return;
		}
		// '통닭 & 목삼겹'처럼 메뉴가 여러 개면 메뉴마다 따로 검색해요.
		const keywords = menu.split(/[&,\/+]/).map((word) => word.trim()).filter(Boolean);
		const place = placeInput.value.trim();
		const idleLabel = button.textContent;
		try {
			let links;
			if (place) {
				links = keywords.map((keyword) => [keyword, mapSearchUrl(place + " " + keyword)]);
			} else {
				setBusy("위치 확인 중…");
				const { latitude, longitude } = await getCurrentPosition();
				links = keywords.map((keyword) => [keyword, mapSearchUrl(keyword, latitude, longitude)]);
			}
			window.open(links[0][1], "_blank", "noopener");
			showLinks(place ? "'" + place + "'" : "현재 위치", keywords[0], links);
		} catch (error) {
			showMessage(error.message);
		} finally {
			button.disabled = false;
			button.textContent = idleLabel;
		}
	}

	function setBusy(label) {
		button.disabled = true;
		button.textContent = label;
	}

	function showLinks(where, firstKeyword, links) {
		const title = document.createElement("p");
		title.className = "nearby-title";
		title.textContent = "구글 지도 새 탭에서 " + where + " 주변 '" + firstKeyword + "' 검색 결과를 열었어요.";

		const reopen = document.createElement("p");
		reopen.append("창이 안 보이면 눌러 주세요:");
		links.forEach(([keyword, url]) => {
			const link = document.createElement("a");
			link.href = url;
			link.target = "_blank";
			link.rel = "noopener";
			link.textContent = "'" + keyword + "' 지도 보기 ↗";
			reopen.append(link);
		});
		result.replaceChildren(title, reopen);
	}

	function showMessage(text) {
		const message = document.createElement("p");
		message.className = "nearby-message";
		message.textContent = text;
		result.replaceChildren(message);
	}
}

function mapSearchUrl(query, lat, lng) {
	const url = "https://www.google.com/maps/search/" + encodeURIComponent(query);
	return lat === undefined ? url : url + "/@" + lat.toFixed(6) + "," + lng.toFixed(6) + ",16z";
}

function getCurrentPosition() {
	return new Promise((resolve, reject) => {
		if (!window.isSecureContext || !navigator.geolocation) {
			reject(new Error("현재 위치는 https 주소나 localhost 에서만 쓸 수 있어요. 위치 칸에 동네 이름을 적어 주세요."));
			return;
		}
		navigator.geolocation.getCurrentPosition(
			(position) => resolve(position.coords),
			(error) => reject(new Error(GEO_ERRORS[error.code] || "현재 위치를 가져오지 못했어요. 위치 칸에 동네 이름을 적어 주세요.")),
			{ timeout: 10000, maximumAge: 60000 },
		);
	});
}
