import { afterEach, beforeAll, beforeEach, describe, expect, jest, spyOn, test } from "bun:test";
import { useFakeSupabase, useNoSupabase } from "./helpers/fake-supabase.js";
import { freshImport, settle } from "./helpers/dom.js";
import { KakaoStatus, kakaoPlace, useFakeKakao } from "./helpers/fake-kakao.js";
import { loadKakao } from "../js/place-picker.js";

const place = { name: "목포생태찌개", address: "서울 중구 무교로 1", lat: 37.567, lng: 126.979 };

// 찾은 주소는 한 화면에서 다시 쓰려고 모듈에 기억해 두므로, 시험마다 새로 불러와요.
let placeNameLink;
let open;
let popup;
let warn;

beforeAll(async () => {
	useFakeKakao();
	await loadKakao();
});

beforeEach(async () => {
	useNoSupabase();
	({ placeNameLink } = await freshImport("js/place-page.js"));
	popup = { opener: "원래 창", closed: false, location: { href: "" } };
	open = spyOn(window, "open").mockImplementation(() => popup);
	warn = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	open.mockRestore();
	warn.mockRestore();
	jest.useRealTimers();
});

describe("placeNameLink", () => {
	test("가게 이름 링크는 새 창으로 열고, 기본 주소는 네이버에서 '이름 주소' 로 찾는다", () => {
		const anchor = placeNameLink(place);
		expect(anchor.tagName).toBe("A");
		expect(anchor.className).toBe("place-name-link");
		expect(anchor.textContent).toBe("목포생태찌개");
		expect(anchor.target).toBe("_blank");
		expect(anchor.rel).toBe("noopener");
		expect(anchor.href).toBe("https://search.naver.com/search.naver?query=" + encodeURIComponent("목포생태찌개 서울 중구 무교로 1"));
	});

	test("주소가 없으면 이름만으로 찾는다", () => {
		expect(placeNameLink({ ...place, address: "" }).href).toBe("https://search.naver.com/search.naver?query=" + encodeURIComponent("목포생태찌개"));
	});

	test("누르면 빈 창을 먼저 열고(opener 끊음), 카카오에서 찾은 가게 페이지를 https 로 연다", async () => {
		const log = useFakeKakao({ keywordSearch: () => [[kakaoPlace("목포생태찌개", { url: "http://place.map.kakao.com/123" })], KakaoStatus.OK] });
		const anchor = placeNameLink(place);
		const event = new MouseEvent("click", { cancelable: true });
		anchor.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
		expect(open.mock.calls[0]).toEqual(["", "_blank"]);
		expect(popup.opener).toBeNull();
		await settle();
		expect(popup.location.href).toBe("https://place.map.kakao.com/123");
		expect(log.searches).toEqual([{ query: "목포생태찌개", options: { x: 126.979, y: 37.567, radius: 300, sort: "distance" } }]);
	});

	test("한 번 찾은 가게는 다시 묻지 않고 그 주소로 바로 연다", async () => {
		const log = useFakeKakao({ keywordSearch: () => [[kakaoPlace("목포생태찌개", { url: "https://place.map.kakao.com/123" })], KakaoStatus.OK] });
		placeNameLink(place).click();
		await settle();
		placeNameLink(place).click();
		await settle();
		expect(log.searches).toHaveLength(1);
		expect(open.mock.calls[1]).toEqual(["https://place.map.kakao.com/123", "_blank", "noopener"]);
	});

	test("카카오에 결과가 없거나 오류면 네이버 검색으로 연다", async () => {
		useFakeKakao({ keywordSearch: () => [[], KakaoStatus.ZERO_RESULT] });
		placeNameLink(place).click();
		await settle();
		expect(popup.location.href).toBe(placeNameLink(place).href);

		({ placeNameLink } = await freshImport("js/place-page.js"));
		popup = { closed: false, location: { href: "" } };
		useFakeKakao({ keywordSearch: () => [[kakaoPlace("무시")], KakaoStatus.ERROR] });
		placeNameLink(place).click();
		await settle();
		expect(popup.location.href).toBe(placeNameLink(place).href);
		expect(warn).not.toHaveBeenCalled();
	});

	test("카카오가 4초 안에 답하지 않으면 경고하고 네이버 검색으로 연다", async () => {
		useFakeKakao({ keywordSearch: () => () => {} });
		jest.useFakeTimers();
		placeNameLink(place).click();
		await Promise.resolve();
		await Promise.resolve();
		jest.advanceTimersByTime(4000);
		jest.useRealTimers();
		await settle();
		expect(popup.location.href).toBe(placeNameLink(place).href);
		expect(warn.mock.calls[0][1].message).toBe("카카오 장소 검색이 4초 안에 끝나지 않았어요.");
	});

	test("누르면 최근 본 가게로 남긴다(로그인 안 했으면 아무것도 쓰지 않음)", async () => {
		const calls = useFakeSupabase({ session: { user: { id: "u" } }, tables: { recent_places: { error: null } } });
		useFakeKakao({ keywordSearch: () => [[], KakaoStatus.ZERO_RESULT] });
		placeNameLink(place).click();
		await settle();
		expect(calls.map((call) => call.table)).toEqual(["recent_places"]);
		expect(calls[0].ops[0][1]).toMatchObject({ name: "목포생태찌개", address: "서울 중구 무교로 1", lat: 37.567, lng: 126.979 });
	});
});
