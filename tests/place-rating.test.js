import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from "bun:test";
import { freshImport } from "./helpers/dom.js";
import { restoreSharedGoogle } from "./helpers/shared-state.js";
import { MIN_REVIEWS, PRIOR_RATING, RATINGS_ENABLED, knownClosed, omechuRating } from "../js/place-rating.js";

// 구글 지도 SDK 가짜. 스크립트를 붙이면 callback(window.omechuGoogleMapsReady)을 부르고, importLibrary("places") 는 Place 를 돌려줘요.
// 모듈은 SDK 약속과 찾은 평점을 기억해 두므로 시험마다 새로 불러와요.
const origin = { name: "목포생태찌개", lat: 37.567, lng: 126.979 };
// 2026-11-04(수) 12:00 KST
const WEDNESDAY_NOON_KST = Date.UTC(2026, 10, 4, 3, 0);

let rating;
let append;
let scripts;
let sdkFails;
let searchByText;
let warn;
let now;

function candidate({ name = "목포생태찌개", lat = origin.lat, lng = origin.lng, ...extra } = {}) {
	return {
		displayName: name,
		location: { lat: () => lat, lng: () => lng },
		rating: 4.5,
		userRatingCount: 200,
		businessStatus: "OPERATIONAL",
		utcOffsetMinutes: 540,
		isOpen: async () => true,
		...extra,
	};
}

function answerWith(...places) {
	searchByText = async () => ({ places });
}

beforeEach(async () => {
	scripts = [];
	sdkFails = false;
	answerWith(candidate());
	window.google = {
		maps: {
			importLibrary: async (name) => (name === "places" ? { Place: { searchByText: (request) => searchByText(request) } } : null),
		},
	};
	append = spyOn(document.head, "append").mockImplementation((script) => {
		scripts.push(script);
		queueMicrotask(() => (sdkFails ? script.onerror() : window.omechuGoogleMapsReady()));
	});
	warn = spyOn(console, "warn").mockImplementation(() => {});
	now = spyOn(Date, "now").mockReturnValue(WEDNESDAY_NOON_KST);
	rating = await freshImport("js/place-rating.js");
});

afterEach(() => {
	append.mockRestore();
	warn.mockRestore();
	now.mockRestore();
	jest.useRealTimers();
	restoreSharedGoogle();
});

describe("omechuRating", () => {
	test("값이 없거나 평점이 숫자가 아니면 null", () => {
		expect(omechuRating(undefined)).toBeNull();
		expect(omechuRating(null)).toBeNull();
		expect(omechuRating({ rating: null, reviews: 500 })).toBeNull();
	});

	test("리뷰가 MIN_REVIEWS 개보다 적으면 null, 딱 그만큼이면 섞은 값", () => {
		expect(MIN_REVIEWS).toBe(10);
		expect(omechuRating({ rating: 5, reviews: 9 })).toBeNull();
		expect(omechuRating({ rating: 5, reviews: 10 })).toBeCloseTo((10 * 5 + 100 * PRIOR_RATING) / 110, 10);
	});

	test("리뷰가 많을수록 구글 평점에, 적을수록 4.0 에 가깝다", () => {
		const many = omechuRating({ rating: 4.6, reviews: 3000 });
		const few = omechuRating({ rating: 4.9, reviews: 120 });
		expect(many).toBeCloseTo((3000 * 4.6 + 400) / 3100, 10);
		expect(few).toBeCloseTo((120 * 4.9 + 400) / 220, 10);
		expect(many).toBeGreaterThan(few);
	});
});

describe("knownClosed", () => {
	test("openNow 가 false 일 때만 true", () => {
		expect(knownClosed({ openNow: false })).toBe(true);
		expect(knownClosed({ openNow: true })).toBe(false);
		expect(knownClosed({ openNow: undefined })).toBe(false);
		expect(knownClosed(null)).toBe(false);
		expect(knownClosed(undefined)).toBe(false);
	});
});

describe("lookupRatings", () => {
	test("구글 키가 들어 있어 평점을 묻는다", () => {
		expect(RATINGS_ENABLED).toBe(true);
	});

	test("SDK 를 한 번만 붙이고, 이름·300m 안으로 5곳까지 묻는다", async () => {
		const requests = [];
		searchByText = async (request) => {
			requests.push(request);
			return { places: [candidate()] };
		};
		await rating.lookupRatings([origin, { ...origin, name: "다른 가게" }]);
		expect(scripts).toHaveLength(1);
		expect(scripts[0].src).toStartWith("https://maps.googleapis.com/maps/api/js?v=beta&loading=async&language=ko&region=KR&callback=omechuGoogleMapsReady&key=");
		expect(scripts[0].async).toBe(true);
		expect(requests[0]).toEqual({
			textQuery: "목포생태찌개",
			fields: ["displayName", "location", "rating", "userRatingCount", "businessStatus", "regularOpeningHours", "currentOpeningHours", "utcOffsetMinutes"],
			locationBias: { center: { lat: 37.567, lng: 126.979 }, radius: 300 },
			maxResultCount: 5,
		});
		expect(requests[1].textQuery).toBe("다른 가게");
	});

	test("같은 가게를 찾으면 평점·리뷰 수·영업 상태를 돌려준다", async () => {
		expect(await rating.lookupRatings([origin])).toEqual([{ rating: 4.5, reviews: 200, openNow: true, closedForGood: false, hours: null }]);
	});

	test("대소문자·띄어쓰기를 무시하고, 한쪽 이름이 다른 쪽에 들어 있으면 같은 가게로 본다", async () => {
		answerWith(candidate({ name: "스타벅스 시청점" }));
		const [found] = await rating.lookupRatings([{ ...origin, name: "스타벅스" }]);
		expect(found).not.toBeNull();
		answerWith(candidate({ name: "BURGER KING" }));
		const [english] = await rating.lookupRatings([{ ...origin, name: "burgerking" }]);
		expect(english).not.toBeNull();
	});

	test("이름이 다르거나, 300m 보다 멀거나, 이름이 비었으면 null", async () => {
		answerWith(candidate({ name: "전혀 다른 집" }), candidate({ name: "목포생태찌개", lat: origin.lat + 0.004 }), candidate({ name: "" }), candidate({ displayName: undefined }));
		expect(await rating.lookupRatings([origin])).toEqual([null]);
	});

	test("가까운 후보 중 첫 번째 같은 가게를 쓴다(300m 경계 안쪽)", async () => {
		// 위도 0.0026도 ≈ 289m
		answerWith(candidate({ lat: origin.lat + 0.0026, rating: 3.9 }), candidate({ rating: 4.8 }));
		const [found] = await rating.lookupRatings([origin]);
		expect(found.rating).toBe(3.9);
	});

	test("평점이 없으면 rating 은 null, 리뷰 수가 없으면 0", async () => {
		answerWith(candidate({ rating: undefined, userRatingCount: undefined }));
		const [found] = await rating.lookupRatings([origin]);
		expect(found).toMatchObject({ rating: null, reviews: 0 });
	});

	test("폐업이면 openNow 는 false 이고 isOpen 을 묻지 않는다", async () => {
		const isOpen = jest.fn(async () => true);
		answerWith(candidate({ businessStatus: "CLOSED_PERMANENTLY", isOpen }));
		const [found] = await rating.lookupRatings([origin]);
		expect(found).toMatchObject({ openNow: false, closedForGood: true });
		expect(isOpen).not.toHaveBeenCalled();
	});

	test("임시 휴업이면 문 닫은 것으로 본다", async () => {
		answerWith(candidate({ businessStatus: "CLOSED_TEMPORARILY" }));
		const [found] = await rating.lookupRatings([origin]);
		expect(found).toMatchObject({ openNow: false, closedForGood: false });
	});

	test("isOpen 이 false 면 영업 종료, 던지면 모름(undefined)", async () => {
		answerWith(candidate({ isOpen: async () => false }));
		expect((await rating.lookupRatings([origin]))[0].openNow).toBe(false);
		answerWith(candidate({ isOpen: async () => {
			throw new Error("no hours");
		} }));
		expect((await rating.lookupRatings([{ ...origin, name: "목포생태찌개 본점" }]))[0].openNow).toBeUndefined();
	});

	test("같은 가게는 다시 묻지 않는다", async () => {
		const search = jest.fn(async () => ({ places: [candidate()] }));
		searchByText = search;
		await rating.lookupRatings([origin]);
		await rating.lookupRatings([{ ...origin }]);
		expect(search).toHaveBeenCalledTimes(1);
	});

	test("검색이 실패하면 경고하고 undefined, 다음에는 다시 묻는다", async () => {
		const search = jest.fn(async () => {
			throw new Error("quota");
		});
		searchByText = search;
		expect(await rating.lookupRatings([origin])).toEqual([undefined]);
		expect(warn.mock.calls[0][0]).toBe("구글 평점을 찾지 못했어요: 목포생태찌개");
		searchByText = async () => ({ places: [candidate()] });
		expect((await rating.lookupRatings([origin]))[0]).toMatchObject({ rating: 4.5 });
		expect(search).toHaveBeenCalledTimes(1);
	});

	test("SDK 스크립트를 못 받으면 undefined 이고, 다음에는 스크립트를 다시 붙인다", async () => {
		sdkFails = true;
		expect(await rating.lookupRatings([origin])).toEqual([undefined]);
		expect(warn.mock.calls[0][1].message).toBe("구글 지도를 불러오지 못했어요.");
		sdkFails = false;
		expect((await rating.lookupRatings([origin]))[0]).toMatchObject({ rating: 4.5 });
		expect(scripts).toHaveLength(2);
	});

	test("4초 안에 답이 없으면 undefined", async () => {
		jest.useFakeTimers();
		searchByText = () => new Promise(() => {});
		const pending = rating.lookupRatings([origin]);
		jest.advanceTimersByTime(4000);
		expect(await pending).toEqual([undefined]);
		expect(warn.mock.calls[0][1].message).toBe("구글 장소 검색이 4초 안에 끝나지 않았어요.");
	});
});

// 오늘 영업시간(hours)은 가게의 utcOffsetMinutes 로 가게 현지 요일을 정해 계산해요. 요일은 0=일 … 6=토예요.
describe("lookupRatings: 오늘 영업시간", () => {
	async function hoursOf(periods, { utcOffsetMinutes = 540, at = WEDNESDAY_NOON_KST } = {}) {
		now.mockReturnValue(at);
		answerWith(candidate({ currentOpeningHours: periods === undefined ? undefined : { periods }, utcOffsetMinutes }));
		const fresh = await freshImport("js/place-rating.js");
		return (await fresh.lookupRatings([origin]))[0].hours;
	}
	const at = (day, hour, minute = 0) => ({ day, hour, minute });

	test("영업시간이 없거나 periods 가 배열이 아니면 null", async () => {
		expect(await hoursOf(undefined)).toBeNull();
		expect(await hoursOf(null)).toBeNull();
	});

	test("일요일 0시에 열고 닫는 시각이 없으면 '24시간'(utcOffset 을 몰라도)", async () => {
		expect(await hoursOf([{ open: at(0, 0) }], { utcOffsetMinutes: null })).toBe("24시간");
	});

	test("utcOffset 을 모르면 null", async () => {
		expect(await hoursOf([{ open: at(3, 11), close: at(3, 21) }], { utcOffsetMinutes: null })).toBeNull();
	});

	test("오늘 연 시간을 'HH:MM~HH:MM' 로 쓴다", async () => {
		expect(await hoursOf([{ open: at(3, 11, 5), close: at(3, 21, 30) }])).toBe("11:05~21:30");
	});

	test("쉬는 시간이 있으면 여는 시각 순으로 ', ' 로 잇는다", async () => {
		expect(await hoursOf([{ open: at(3, 17), close: at(3, 22) }, { open: at(3, 11), close: at(3, 15) }])).toBe("11:00~15:00, 17:00~22:00");
	});

	test("어제 저녁부터 이어진 영업은 자정부터 쓰고, 오늘 밤 영업은 다음 날 닫는 시각까지 쓴다", async () => {
		expect(await hoursOf([{ open: at(3, 18), close: at(4, 2) }, { open: at(2, 18), close: at(3, 2) }])).toBe("00:00~02:00, 18:00~02:00");
	});

	test("어제부터 이어진 영업이 자정에 딱 끝나면 오늘 몫은 없다", async () => {
		expect(await hoursOf([{ open: at(2, 18), close: at(3, 0) }])).toBeNull();
	});

	test("오늘을 통째로 지나는 영업은 '24시간'", async () => {
		expect(await hoursOf([{ open: at(2, 10), close: at(4, 10) }])).toBe("24시간");
	});

	test("오늘 쉬는 날이면 null, 닫는 시각이 없는 기간(24시간 표시 말고)은 뺀다", async () => {
		expect(await hoursOf([{ open: at(1, 11), close: at(1, 21) }, { open: at(4, 11), close: at(4, 21) }])).toBeNull();
		expect(await hoursOf([{ open: at(3, 11) }])).toBeNull();
	});

	test("토요일 밤부터 일요일 새벽까지는 주가 바뀌어도 이어 본다", async () => {
		const sundayNoonKst = Date.UTC(2026, 10, 8, 3, 0);
		expect(await hoursOf([{ open: at(6, 22), close: at(0, 3) }], { at: sundayNoonKst })).toBe("00:00~03:00");
	});

	test("요일은 가게 현지 시각으로 정한다(UTC 수요일 16시 = 한국 목요일 1시)", async () => {
		const periods = [{ open: at(3, 11), close: at(3, 21) }, { open: at(4, 9), close: at(4, 18) }];
		const lateWednesdayUtc = Date.UTC(2026, 10, 4, 16, 0);
		expect(await hoursOf(periods, { at: lateWednesdayUtc, utcOffsetMinutes: 540 })).toBe("09:00~18:00");
		expect(await hoursOf(periods, { at: lateWednesdayUtc, utcOffsetMinutes: 0 })).toBe("11:00~21:00");
	});
});
