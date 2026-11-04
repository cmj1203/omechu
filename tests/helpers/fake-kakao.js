// 카카오 지도 SDK 를 흉내 내는 가짜예요. js/place-picker.js 의 loadKakao 는 처음 받은 window.kakao 를 계속 쓰므로,
// 객체는 하나만 만들어 두고 시험마다 useFakeKakao 로 답하는 방식만 바꿔요.
// 쓰기 전에 tests/helpers/dom.js 를 먼저 불러 와야 해요(window 가 있어야 해요).
const Status = { OK: "OK", ZERO_RESULT: "ZERO_RESULT", ERROR: "ERROR" };
const behavior = {
	keywordSearch: null,
	coord2Address: null,
};
const log = { searches: [], addresses: [], maps: [], overlays: [], relayouts: 0, bounds: [] };

class LatLng {
	constructor(lat, lng) {
		this.lat = lat;
		this.lng = lng;
	}
}

class LatLngBounds {
	constructor() {
		this.points = [];
	}
	extend(point) {
		this.points.push(point);
	}
}

class FakeMap {
	constructor(container, options) {
		this.container = container;
		this.options = options;
		log.maps.push(this);
	}
	relayout() {
		log.relayouts += 1;
	}
	setBounds(bounds) {
		log.bounds.push(bounds);
	}
}

class CustomOverlay {
	constructor(options) {
		this.options = options;
		this.map = null;
		log.overlays.push(this);
	}
	setMap(map) {
		this.map = map;
	}
}

class Places {
	keywordSearch(query, callback, options) {
		log.searches.push({ query, options });
		const respond = behavior.keywordSearch ?? (() => [[], Status.ZERO_RESULT]);
		const answer = respond(query, options);
		// 답을 미뤄 두려면 respond 가 함수(콜백을 받는)를 돌려줘요.
		if (typeof answer === "function") {
			answer((data, status) => callback(data, status));
			return;
		}
		const [data, status] = answer;
		queueMicrotask(() => callback(data, status));
	}
}

class Geocoder {
	coord2Address(lng, lat, callback) {
		log.addresses.push({ lng, lat });
		const respond = behavior.coord2Address ?? (() => [[], Status.ZERO_RESULT]);
		const answer = respond(lng, lat);
		if (typeof answer === "function") {
			answer((data, status) => callback(data, status));
			return;
		}
		const [data, status] = answer;
		queueMicrotask(() => callback(data, status));
	}
}

export const fakeKakao = {
	maps: {
		load(callback) {
			callback();
		},
		LatLng,
		LatLngBounds,
		Map: FakeMap,
		CustomOverlay,
		services: {
			Places,
			Geocoder,
			Status,
			SortBy: { DISTANCE: "distance", ACCURACY: "accuracy" },
		},
	},
};

window.kakao = fakeKakao;

export const KakaoStatus = Status;

// keywordSearch(query, options) 와 coord2Address(lng, lat) 는 [data, status] 를 돌려주거나,
// 답을 늦추려면 (reply) => … 모양의 함수를 돌려줘요. 돌려주는 log 에 부른 기록이 쌓여요.
export function useFakeKakao({ keywordSearch = null, coord2Address = null } = {}) {
	window.kakao = fakeKakao;
	behavior.keywordSearch = keywordSearch;
	behavior.coord2Address = coord2Address;
	log.searches = [];
	log.addresses = [];
	log.maps = [];
	log.overlays = [];
	log.relayouts = 0;
	log.bounds = [];
	return log;
}

// 카카오 장소 검색 결과 한 줄 모양
export function kakaoPlace(name, { x = "126.978", y = "37.5665", road = "", address = "서울 중구", url = "http://place.map.kakao.com/1" } = {}) {
	return { place_name: name, x, y, road_address_name: road, address_name: address, place_url: url };
}
