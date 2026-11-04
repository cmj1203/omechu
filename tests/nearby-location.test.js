import { afterEach, beforeAll, beforeEach, describe, expect, jest, spyOn, test } from "bun:test";
import "./helpers/dom.js";
import { KakaoStatus, useFakeKakao } from "./helpers/fake-kakao.js";
import { addressOf, currentPosition, geocode, locationAlreadyAllowed } from "../js/nearby-location.js";
import { loadKakao } from "../js/place-picker.js";

// navigator·window 의 속성을 이 시험 동안만 바꾸고 afterEach 에서 되돌려요.
const restores = [];
function override(target, key, value) {
	const own = Object.getOwnPropertyDescriptor(target, key);
	Object.defineProperty(target, key, { value, configurable: true, writable: true });
	restores.push(() => {
		if (own) {
			Object.defineProperty(target, key, own);
		} else {
			delete target[key];
		}
	});
}

let warn;

beforeAll(async () => {
	useFakeKakao();
	await loadKakao();
});

beforeEach(() => {
	warn = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	restores.splice(0).reverse().forEach((restore) => restore());
	warn.mockRestore();
	jest.useRealTimers();
});

describe("locationAlreadyAllowed", () => {
	test("permissions API 가 없으면 false", async () => {
		override(navigator, "permissions", undefined);
		expect(await locationAlreadyAllowed()).toBe(false);
	});

	test("geolocation 권한이 granted 면 true, 그 밖에는 false", async () => {
		let state = "granted";
		const asked = [];
		override(navigator, "permissions", { query: async (descriptor) => {
			asked.push(descriptor);
			return { state };
		} });
		expect(await locationAlreadyAllowed()).toBe(true);
		state = "prompt";
		expect(await locationAlreadyAllowed()).toBe(false);
		state = "denied";
		expect(await locationAlreadyAllowed()).toBe(false);
		expect(asked[0]).toEqual({ name: "geolocation" });
	});
});

describe("currentPosition", () => {
	function geolocation(run) {
		const calls = [];
		override(navigator, "geolocation", { getCurrentPosition: (ok, fail, options) => {
			calls.push(options);
			run(ok, fail);
		} });
		return calls;
	}

	test("https 가 아니면 위치를 묻지 않고 거절한다", async () => {
		override(window, "isSecureContext", false);
		const calls = geolocation(() => {});
		await expect(currentPosition()).rejects.toThrow("현재 위치는 https 주소나 localhost 에서만 쓸 수 있어요. 위치 칸에 동네 이름을 적어 주세요.");
		expect(calls).toEqual([]);
	});

	test("geolocation 이 없으면 거절한다", async () => {
		override(window, "isSecureContext", true);
		override(navigator, "geolocation", undefined);
		await expect(currentPosition()).rejects.toThrow("https 주소나 localhost");
	});

	test("위치를 받으면 '현재 위치' 와 좌표로 답하고, 10초 제한·1분 캐시로 묻는다", async () => {
		override(window, "isSecureContext", true);
		const calls = geolocation((ok) => ok({ coords: { latitude: 37.1, longitude: 127.2 } }));
		expect(await currentPosition()).toEqual({ label: "현재 위치", lat: 37.1, lng: 127.2 });
		expect(calls).toEqual([{ timeout: 10000, maximumAge: 60000 }]);
	});

	test.each([
		[1, "위치 권한이 꺼져 있어요."],
		[2, "현재 위치를 알 수 없어요."],
		[3, "위치를 확인하는 데 너무 오래 걸려요."],
		[9, "현재 위치를 가져오지 못했어요."],
	])("오류 코드 %d 는 알맞은 안내로 거절한다", async (code, text) => {
		override(window, "isSecureContext", true);
		geolocation((ok, fail) => fail({ code }));
		await expect(currentPosition()).rejects.toThrow(text);
	});
});

describe("addressOf", () => {
	const origin = { label: "현재 위치", lat: 37.5665, lng: 126.978 };

	test("경도·위도 순서로 묻고 도로명 주소를 먼저 쓴다", async () => {
		const log = useFakeKakao({ coord2Address: () => [[{ road_address: { address_name: "서울 중구 세종대로 110" }, address: { address_name: "서울 중구 태평로1가 31" } }], KakaoStatus.OK] });
		expect(await addressOf(origin)).toBe("서울 중구 세종대로 110");
		expect(log.addresses).toEqual([{ lng: 126.978, lat: 37.5665 }]);
	});

	test("도로명 주소가 없으면 지번 주소", async () => {
		useFakeKakao({ coord2Address: () => [[{ road_address: null, address: { address_name: "서울 중구 태평로1가 31" } }], KakaoStatus.OK] });
		expect(await addressOf(origin)).toBe("서울 중구 태평로1가 31");
	});

	test("주소가 없거나 결과가 OK 가 아니면 null", async () => {
		useFakeKakao({ coord2Address: () => [[{ road_address: null, address: null }], KakaoStatus.OK] });
		expect(await addressOf(origin)).toBeNull();
		useFakeKakao({ coord2Address: () => [[{ road_address: { address_name: "무시" } }], KakaoStatus.ERROR] });
		expect(await addressOf(origin)).toBeNull();
		expect(warn).not.toHaveBeenCalled();
	});

	test("4초 안에 답이 없으면 경고하고 null", async () => {
		useFakeKakao({ coord2Address: () => () => {} });
		jest.useFakeTimers();
		const found = addressOf(origin);
		await Promise.resolve();
		await Promise.resolve();
		jest.advanceTimersByTime(4000);
		expect(await found).toBeNull();
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][1].message).toBe("카카오 주소 찾기가 4초 안에 끝나지 않았어요.");
	});
});

describe("geocode", () => {
	let fetchSpy;

	afterEach(() => {
		fetchSpy?.mockRestore();
	});

	function answer(body, status = 200) {
		fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(body), { status }));
	}

	test("Nominatim 에 한국 안·한국어로 한 곳만 묻고 숫자 좌표로 답한다", async () => {
		answer([{ lat: "37.5547", lon: "126.9707" }]);
		expect(await geocode("서울역")).toEqual({ label: "서울역", lat: 37.5547, lng: 126.9707 });
		const [url, options] = fetchSpy.mock.calls[0];
		const parsed = new URL(url);
		expect(parsed.origin + parsed.pathname).toBe("https://nominatim.openstreetmap.org/search");
		expect(Object.fromEntries(parsed.searchParams)).toEqual({ q: "서울역", format: "json", limit: "1", countrycodes: "kr", "accept-language": "ko" });
		expect(options.signal).toBeInstanceOf(AbortSignal);
	});

	test("응답이 실패면 다시 누르라고 던진다", async () => {
		answer([], 503);
		await expect(geocode("서울역")).rejects.toThrow("동네 위치를 찾지 못했어요. 잠시 후 다시 눌러 주세요.");
	});

	test("결과가 없으면 적은 이름을 넣어 던진다", async () => {
		answer([]);
		await expect(geocode("없는동")).rejects.toThrow("'없는동' 위치를 찾지 못했어요. 역 이름이나 동 이름으로 적어 주세요.");
	});
});
