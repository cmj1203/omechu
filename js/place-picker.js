// 카카오 JavaScript 키는 브라우저에 그대로 보이는 공개용 키예요. 카카오 개발자 사이트에 등록한 도메인에서만 동작해요.
const KAKAO_JS_KEY = "8270282689b2cfb87a81c9c706961d5e";
const SDK_URL = "https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&libraries=services&appkey=" + KAKAO_JS_KEY;

let sdk = null;

function loadKakao() {
	sdk ??= new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = SDK_URL;
		script.onload = () => window.kakao.maps.load(() => resolve(window.kakao));
		script.onerror = () => reject(new Error("카카오 지도를 불러오지 못했어요."));
		document.head.append(script);
	}).catch((error) => {
		sdk = null;
		throw error;
	});
	return sdk;
}

// 위치 칸을 누르면 여는 장소 검색 창. 같은 이름의 역이 여러 곳이면(인천 가정역, 전남 곡성 가정역) 도로명 주소를 보고 고르게 해요.
export function initPlacePicker(dialog) {
	const form = dialog.querySelector(".place-picker-form");
	const input = form.elements.q;
	const mapBox = dialog.querySelector(".place-picker-map");
	const message = dialog.querySelector(".place-picker-message");
	const list = dialog.querySelector(".place-picker-results");
	let map = null;
	let pins = [];
	let picked = null;
	let resolvePick = null;
	let searchId = 0;
	let failed = false;

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		input.blur();
		search(input.value.trim());
	});
	dialog.querySelector(".place-picker-close").addEventListener("click", () => dialog.close());
	dialog.addEventListener("close", () => {
		const done = resolvePick;
		resolvePick = null;
		done?.(picked);
	});

	return {
		get failed() {
			return failed;
		},
		open(query) {
			picked = null;
			input.value = query;
			list.replaceChildren();
			clearPins();
			mapBox.hidden = true;
			showMessage("");
			dialog.showModal();
			if (query) {
				search(query);
			} else {
				input.focus();
			}
			return new Promise((resolve) => {
				resolvePick = resolve;
			});
		},
	};

	async function search(query) {
		const id = ++searchId;
		list.replaceChildren();
		if (!query) {
			showMessage("찾을 곳의 이름을 적어 주세요.");
			return;
		}
		showMessage("찾는 중…");
		let kakao;
		try {
			kakao = await loadKakao();
		} catch (error) {
			if (id === searchId) {
				failed = true;
				showMessage(error.message + " 창을 닫고 위치 칸에 직접 적어 주세요.");
			}
			return;
		}
		if (id !== searchId) {
			return;
		}
		new kakao.maps.services.Places().keywordSearch(query, (places, status) => {
			if (id !== searchId) {
				return;
			}
			if (status === kakao.maps.services.Status.OK) {
				showResults(kakao, places);
				return;
			}
			clearPins();
			mapBox.hidden = true;
			showMessage(status === kakao.maps.services.Status.ZERO_RESULT
				? "'" + query + "' 검색 결과가 없어요. 다른 이름으로 찾아 보세요."
				: "위치를 찾지 못했어요. 잠시 후 다시 찾아 주세요.");
		});
	}

	function showResults(kakao, places) {
		showMessage("");
		mapBox.hidden = false;
		const bounds = new kakao.maps.LatLngBounds();
		const positions = places.map((place) => new kakao.maps.LatLng(Number(place.y), Number(place.x)));
		positions.forEach((position) => bounds.extend(position));
		if (map) {
			map.relayout();
		} else {
			map = new kakao.maps.Map(mapBox, { center: positions[0], level: 8 });
		}
		clearPins();
		pins = places.map((place, index) => {
			const pin = document.createElement("button");
			pin.type = "button";
			pin.className = "place-pin";
			pin.textContent = String(index + 1);
			pin.setAttribute("aria-label", place.place_name + " 고르기");
			pin.addEventListener("click", () => choose(place));
			const overlay = new kakao.maps.CustomOverlay({ position: positions[index], content: pin, yAnchor: 0.5, zIndex: places.length - index });
			overlay.setMap(map);
			return overlay;
		});
		map.setBounds(bounds);
		list.replaceChildren(...places.map((place, index) => resultItem(place, index)));
		list.scrollTop = 0;
	}

	function resultItem(place, index) {
		const button = document.createElement("button");
		button.type = "button";
		const number = document.createElement("span");
		number.className = "place-pick-number";
		number.textContent = String(index + 1);
		const name = document.createElement("strong");
		name.textContent = place.place_name;
		const address = document.createElement("span");
		address.className = "place-pick-address";
		address.textContent = place.road_address_name || place.address_name;
		button.append(number, name, address);
		button.addEventListener("click", () => choose(place));
		const item = document.createElement("li");
		item.append(button);
		return item;
	}

	function choose(place) {
		picked = {
			label: place.place_name,
			address: place.road_address_name || place.address_name,
			lat: Number(place.y),
			lng: Number(place.x),
		};
		dialog.close();
	}

	function clearPins() {
		pins.forEach((pin) => pin.setMap(null));
		pins = [];
	}

	function showMessage(text) {
		message.textContent = text;
		message.hidden = !text;
	}
}
