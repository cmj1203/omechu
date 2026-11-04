import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { freshImport, setBody, settle } from "./helpers/dom.js";
import { useFakeSupabase, useNoSupabase } from "./helpers/fake-supabase.js";
import { favoriteIds, placeId } from "../js/member.js";

// 모듈 안에 알린 가게 목록(localStorage 에서 읽음)과 사유 창이 있어서 시험마다 새로 불러와요.
let renderer;
let warn;
const navigatorBackup = {};

const origin = { label: "시청역", lat: 37.5665, lng: 126.978 };

function place(name, extra = {}) {
	return { name, lat: 37.567, lng: 126.979, distance: 350, walkMinutes: 7, address: "", phone: "", officialVisits: 0, ...extra };
}

function setNavigator(key, value) {
	if (!(key in navigatorBackup)) {
		navigatorBackup[key] = Object.getOwnPropertyDescriptor(navigator, key);
	}
	Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
}

function restoreNavigator() {
	for (const [key, descriptor] of Object.entries(navigatorBackup)) {
		if (descriptor) {
			Object.defineProperty(navigator, key, descriptor);
		} else {
			delete navigator[key];
		}
		delete navigatorBackup[key];
	}
}

// 열려 있는 dialog 에서 글자가 같은 단추를 눌러요(form method="dialog" 라 그 단추 값으로 닫혀요).
function clickDialogButton(text) {
	const dialog = [...document.querySelectorAll("dialog")].find((element) => element.open);
	const button = [...dialog.querySelectorAll("button")].find((element) => element.textContent === text);
	button.click();
}

beforeEach(async () => {
	setBody("");
	localStorage.clear();
	useNoSupabase();
	warn = spyOn(console, "warn").mockImplementation(() => {});
	renderer = await freshImport("js/nearby-renderer.js");
});

afterEach(() => {
	warn.mockRestore();
	restoreNavigator();
	localStorage.clear();
});

describe("formatDistance", () => {
	test("1000m 보다 짧으면 m, 아니면 소수 한 자리 km 로 적는다", () => {
		expect(renderer.formatDistance(0)).toBe("0m");
		expect(renderer.formatDistance(999)).toBe("999m");
		expect(renderer.formatDistance(1000)).toBe("1.0km");
		expect(renderer.formatDistance(1250)).toBe("1.3km");
	});
});

describe("kakaoMapUrl", () => {
	test("이름의 쉼표는 공백으로 바꾸고 주소에 맞게 인코딩한다", () => {
		expect(renderer.kakaoMapUrl({ name: "밥,술 집", lat: 37.5, lng: 127 }))
			.toBe("https://map.kakao.com/link/map/" + encodeURIComponent("밥 술 집") + ",37.5,127");
	});
});

describe("paragraph", () => {
	test("클래스와 글자를 가진 p 를 만든다", () => {
		const element = renderer.paragraph("note", "안내");
		expect(element.tagName).toBe("P");
		expect(element.className).toBe("note");
		expect(element.textContent).toBe("안내");
	});
});

describe("footer", () => {
	const mapsLink = (note) => [...note.querySelectorAll("a")].at(-1).href;

	test("위치가 글자면 '위치 메뉴'로 구글 지도에서 찾는다", () => {
		const note = renderer.footer({ name: "김치찌개" }, "강남역");
		expect(mapsLink(note)).toBe("https://www.google.com/maps/search/" + encodeURIComponent("강남역 김치찌개"));
		expect(note.textContent).not.toContain("평점 ©");
	});

	test("위치가 없으면 메뉴 이름만으로 찾는다", () => {
		expect(mapsLink(renderer.footer({ name: "김치찌개" }, ""))).toBe("https://www.google.com/maps/search/" + encodeURIComponent("김치찌개"));
		expect(mapsLink(renderer.footer({ name: "김치찌개" }, null))).toBe("https://www.google.com/maps/search/" + encodeURIComponent("김치찌개"));
	});

	test("위치가 좌표면 그 좌표 둘레(16z)에서 찾는다", () => {
		expect(mapsLink(renderer.footer({ name: "국수" }, { lat: 37.1234567, lng: 127.5 })))
			.toBe("https://www.google.com/maps/search/" + encodeURIComponent("국수") + "/@37.123457,127.500000,16z");
	});

	test("withRatings 면 구글 평점 출처를 같이 적는다", () => {
		const note = renderer.footer({ name: "국수" }, "", true);
		expect(note.textContent).toContain("평점 © Google ·");
		expect(note.querySelector("a").href).toBe("https://www.openstreetmap.org/copyright");
	});
});

describe("restaurantCard", () => {
	test("추천 라벨·도보 시간·주소와 전화·길찾기와 지도 링크를 그린다", () => {
		const card = renderer.restaurantCard(place("종로 김치찌개", { menuName: "김치찌개", address: "서울 종로구", phone: "02-111-2222", distance: 1250, walkMinutes: 24 }), origin);
		expect(card.querySelector(".restaurant-label").textContent).toBe("추천 식당 · 김치찌개");
		expect(card.querySelector(".restaurant-walk").textContent).toBe("도보 약 24분 · 1.3km");
		expect(card.querySelector(".restaurant-info").textContent).toBe("서울 종로구 · 02-111-2222");
		const links = [...card.querySelectorAll(".restaurant-links a")].map((anchor) => anchor.href);
		expect(links).toEqual([
			"https://map.kakao.com/link/from/" + encodeURIComponent("시청역") + ",37.5665,126.978/to/" + encodeURIComponent("종로 김치찌개") + ",37.567,126.979",
			"https://map.kakao.com/link/map/" + encodeURIComponent("종로 김치찌개") + ",37.567,126.979",
		]);
		expect(card.querySelector(".report-button")).not.toBeNull();
		expect(card.querySelector(".another-button")).toBeNull();
	});

	test("메뉴 이름이 없으면 라벨은 '추천 식당'뿐이고, 주소·전화가 없으면 그 줄이 없다", () => {
		const card = renderer.restaurantCard(place("가게"), origin);
		expect(card.querySelector(".restaurant-label").textContent).toBe("추천 식당");
		expect(card.querySelector(".restaurant-info")).toBeNull();
	});

	test("평점을 묻지 못했으면(undefined) 평점을 붙이지 않고 영업시간은 '--:--'다", () => {
		const card = renderer.restaurantCard(place("가게"), origin);
		expect(card.querySelector(".restaurant-rating")).toBeNull();
		expect(card.querySelector(".restaurant-hours").textContent).toBe("영업시간 --:--");
		expect(card.querySelector(".open-status")).toBeNull();
	});

	test("리뷰가 충분하면 평점을 소수 한 자리로, 리뷰 수를 천 단위 쉼표로 붙인다", () => {
		const card = renderer.restaurantCard(place("가게", { googleRating: { rating: 4.56, reviews: 1234, openNow: true, hours: "11:00~21:00" } }), origin);
		const rating = card.querySelector(".restaurant-rating");
		expect(rating.textContent).toBe("구글 평점 4.6 · 리뷰 1,234");
		expect(rating.title).toBe("구글 평점 4.6 · 리뷰 1,234개");
		expect(card.querySelector(".restaurant-hours").textContent).toBe("영업시간 11:00~21:00 · 영업 중");
		expect(card.querySelector(".open-status").className).toBe("open-status");
	});

	test("리뷰가 10개보다 적으면 평점을 '-'로 적고 리뷰 수는 빼며 까닭을 title 에 적는다", () => {
		const rating = renderer.restaurantCard(place("가게", { googleRating: { rating: 5, reviews: 9 } }), origin).querySelector(".restaurant-rating");
		expect(rating.textContent).toBe("구글 평점 -");
		expect(rating.title).toBe("구글 리뷰가 10개보다 적어서(9개) 평점을 쓰지 않아요");
	});

	test("리뷰가 정확히 10개면 평점을 쓴다", () => {
		const rating = renderer.restaurantCard(place("가게", { googleRating: { rating: 4.0, reviews: 10 } }), origin).querySelector(".restaurant-rating");
		expect(rating.textContent).toBe("구글 평점 4.0 · 리뷰 10");
	});

	test("구글에서 못 찾았으면(null) 평점 '-'와 '구글 평점이 없어요'를 적는다", () => {
		const rating = renderer.restaurantCard(place("가게", { googleRating: null }), origin).querySelector(".restaurant-rating");
		expect(rating.textContent).toBe("구글 평점 -");
		expect(rating.title).toBe("구글 평점이 없어요");
	});

	test("영업 종료·폐업은 closed 클래스로 적는다", () => {
		const closed = renderer.restaurantCard(place("가게", { googleRating: { rating: null, reviews: 0, openNow: false } }), origin);
		expect(closed.querySelector(".open-status").textContent).toBe("영업 종료");
		expect(closed.querySelector(".open-status").className).toBe("open-status closed");
		const gone = renderer.restaurantCard(place("가게", { googleRating: { rating: null, reviews: 0, openNow: false, closedForGood: true } }), origin);
		expect(gone.querySelector(".open-status").textContent).toBe("폐업");
	});

	test("공무원 단골 횟수가 있으면 공무원 맛집 탭으로 가는 배지를 붙인다", () => {
		const badge = renderer.restaurantCard(place("가게", { officialVisits: 3 }), origin).querySelector(".official-badge");
		expect(badge.textContent).toBe("공무원 단골 · 3번");
		expect(badge.getAttribute("href")).toBe("official.html");
	});

	test("withReport 가 false 면 경고 단추를 두지 않는다", () => {
		expect(renderer.restaurantCard(place("가게"), origin, false).querySelector(".report-button")).toBeNull();
	});

	test("'다른 가게' 단추는 누르면 꺼지고 onAnother 를 부른다", () => {
		let called = 0;
		const card = renderer.restaurantCard(place("가게"), origin, true, () => {
			called += 1;
		});
		const button = card.querySelector(".another-button");
		button.click();
		button.click();
		expect(called).toBe(1);
		expect(button.disabled).toBe(true);
	});
});

describe("공유하기 단추", () => {
	const shareButton = (card) => [...card.querySelectorAll("button")].find((button) => button.textContent === "공유하기");

	test("공유 창이 있으면 메뉴 이름과 '내 위치' 기준 도보 시간을 보낸다", async () => {
		const shared = [];
		setNavigator("share", async (data) => {
			shared.push(data);
		});
		const card = renderer.restaurantCard(place("종로 김치찌개", { menuName: "김치찌개", walkMinutes: 5 }), { ...origin, label: "현재 위치" });
		shareButton(card).click();
		await settle();
		expect(shared).toEqual([{
			title: "오메추 추천",
			text: "오늘 메뉴는 김치찌개! 종로 김치찌개 (내 위치에서 도보 약 5분)",
			url: "https://map.kakao.com/link/map/" + encodeURIComponent("종로 김치찌개") + ",37.567,126.979",
		}]);
	});

	test("공유 창을 사용자가 닫으면(AbortError) 복사하지 않는다", async () => {
		const copied = [];
		setNavigator("share", async () => {
			throw Object.assign(new Error("취소"), { name: "AbortError" });
		});
		setNavigator("clipboard", { writeText: async (text) => copied.push(text) });
		const card = renderer.restaurantCard(place("가게"), origin);
		shareButton(card).click();
		await settle();
		expect(copied).toEqual([]);
		expect(card.textContent).toContain("공유하기");
	});

	test("공유 창이 다른 오류로 실패하거나 없으면 글과 링크를 복사하고 '복사했어요'를 2초 보여 준다", async () => {
		const copied = [];
		setNavigator("share", async () => {
			throw new Error("not allowed");
		});
		setNavigator("clipboard", { writeText: async (text) => copied.push(text) });
		const card = renderer.restaurantCard(place("가게"), origin);
		const button = shareButton(card);
		button.click();
		await settle();
		expect(copied).toEqual(["오늘은 여기 어때? 가게 (시청역에서 도보 약 7분)\nhttps://map.kakao.com/link/map/" + encodeURIComponent("가게") + ",37.567,126.979"]);
		expect(button.textContent).toBe("복사했어요");
	});

	test("복사도 못 하면 '공유하지 못했어요'를 보여 주고 2초 뒤 되돌린다", async () => {
		setNavigator("share", undefined);
		setNavigator("clipboard", { writeText: async () => {
			throw new Error("denied");
		} });
		const card = renderer.restaurantCard(place("가게"), origin);
		const button = shareButton(card);
		const timeout = spyOn(globalThis, "setTimeout");
		try {
			button.click();
			await settle();
			expect(button.textContent).toBe("공유하지 못했어요");
			const restore = timeout.mock.calls.find(([, delay]) => delay === 2000)[0];
			restore();
			expect(button.textContent).toBe("공유하기");
		} finally {
			timeout.mockRestore();
		}
	});
});

describe("경고 단추(가게 문제 알리기)", () => {
	test("사유를 고르면 closure_reports 에 넣고 '알렸어요'로 꺼지며 이 기기에 기억한다", async () => {
		const calls = useFakeSupabase({ tables: { closure_reports: { data: null, error: null } } });
		const card = renderer.restaurantCard(place("문닫은집", { address: "서울 중구" }), origin);
		document.body.append(card);
		const button = card.querySelector(".report-button");
		expect(button.getAttribute("aria-label")).toBe("가게 문제 알리기");
		expect(button.textContent).toBe("");
		button.click();
		await settle();
		const dialog = document.querySelector("dialog.report-dialog");
		expect(dialog.open).toBe(true);
		expect(dialog.querySelector(".report-dialog-title").textContent).toBe("문닫은집");
		clickDialogButton("문 닫았어요");
		await settle();
		expect(calls).toEqual([{ table: "closure_reports", ops: [["insert", { name: "문닫은집", address: "서울 중구", lat: 37.567, lng: 126.979, reason: "closed" }]] }]);
		expect(button.textContent).toBe("알렸어요");
		expect(button.disabled).toBe(true);
		expect(JSON.parse(localStorage.getItem("omechu.reportedPlaces"))).toEqual(["문닫은집|37.567|126.979"]);
	});

	test("취소하면 아무것도 보내지 않는다", async () => {
		const calls = useFakeSupabase({ tables: { closure_reports: { data: null, error: null } } });
		const button = renderer.restaurantCard(place("가게"), origin).querySelector(".report-button");
		button.click();
		await settle();
		clickDialogButton("취소");
		await settle();
		expect(calls).toEqual([]);
		expect(button.disabled).toBe(false);
	});

	test("창 바깥(dialog 자신)을 누르면 취소로 본다", async () => {
		const calls = useFakeSupabase({ tables: { closure_reports: { data: null, error: null } } });
		const button = renderer.restaurantCard(place("가게"), origin).querySelector(".report-button");
		button.click();
		await settle();
		const dialog = document.querySelector("dialog.report-dialog");
		dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await settle();
		expect(dialog.open).toBe(false);
		expect(calls).toEqual([]);
	});

	test("보내지 못하면 '알리지 못했어요'를 2초 보여 준 뒤 다시 누를 수 있게 돌린다", async () => {
		useFakeSupabase({ tables: { closure_reports: { data: null, error: { message: "denied" } } } });
		const button = renderer.restaurantCard(place("가게"), origin).querySelector(".report-button");
		const timeout = spyOn(globalThis, "setTimeout");
		try {
			button.click();
			await settle();
			clickDialogButton("정보가 없어요");
			await settle();
			expect(button.textContent).toBe("알리지 못했어요");
			expect(button.disabled).toBe(true);
			timeout.mock.calls.find(([, delay]) => delay === 2000)[0]();
			expect(button.textContent).toBe("");
			expect(button.disabled).toBe(false);
		} finally {
			timeout.mockRestore();
		}
		expect(localStorage.getItem("omechu.reportedPlaces")).toBeNull();
	});

	test("Supabase 가 없으면 보내지 못한 것으로 본다", async () => {
		const button = renderer.restaurantCard(place("가게"), origin).querySelector(".report-button");
		button.click();
		await settle();
		clickDialogButton("찾을 수 없어요");
		await settle();
		expect(button.textContent).toBe("알리지 못했어요");
	});

	test("이 기기에서 이미 알린 가게는 처음부터 '알렸어요'로 꺼져 있다", async () => {
		localStorage.setItem("omechu.reportedPlaces", JSON.stringify(["가게|37.567|126.979", 3]));
		const fresh = await freshImport("js/nearby-renderer.js");
		const button = fresh.restaurantCard(place("가게"), origin).querySelector(".report-button");
		expect(button.textContent).toBe("알렸어요");
		expect(button.disabled).toBe(true);
	});

	test("저장된 값이 JSON 이 아니거나 배열이 아니면 알린 가게가 없는 것으로 본다", async () => {
		for (const saved of ["{깨짐", JSON.stringify({ a: 1 })]) {
			localStorage.setItem("omechu.reportedPlaces", saved);
			const fresh = await freshImport("js/nearby-renderer.js");
			expect(fresh.restaurantCard(place("가게"), origin).querySelector(".report-button").disabled).toBe(false);
		}
	});
});

describe("othersList", () => {
	test("제목과 가게마다 이름 링크·메뉴 표시·배지·평점·문 닫음·도보 시간을 그린다", () => {
		const list = renderer.othersList([
			place("A", { menuName: "국수", officialVisits: 2, googleRating: { rating: 4.2, reviews: 50, openNow: false }, distance: 120, walkMinutes: 3 }),
			place("B", { lat: 37.6, distance: 1500, walkMinutes: 29 }),
		], "다른 가까운 곳");
		expect(list.querySelector(".others-title").textContent).toBe("다른 가까운 곳");
		const [first, second] = list.querySelectorAll("ol > li");
		expect(first.querySelector(".place-name-link").textContent).toBe("A");
		expect(first.querySelector(".menu-tag").textContent).toBe("국수");
		expect(first.querySelector(".official-badge").textContent).toBe("공무원 단골 · 2번");
		expect(first.querySelector(".rating-tag").textContent).toBe("★ 4.2");
		expect(first.querySelector(".open-tag").textContent).toBe("영업 종료");
		expect(first.querySelector("span:last-child").textContent).toBe("도보 약 3분 · 120m");
		expect(second.querySelector(".menu-tag")).toBeNull();
		expect(second.querySelector(".rating-tag")).toBeNull();
		expect(second.querySelector(".open-tag")).toBeNull();
		expect(second.querySelector("span:last-child").textContent).toBe("도보 약 29분 · 1.5km");
	});

	test("영업 중인 가게에는 영업 표시를 붙이지 않는다", () => {
		const list = renderer.othersList([place("A", { googleRating: { rating: 4.5, reviews: 100, openNow: true } })], "목록");
		expect(list.querySelector(".open-tag")).toBeNull();
	});

	test("즐겨찾기 별은 로그인 상태일 때만 줄마다 붙는다", async () => {
		const ids = await favoriteIds();
		const list = renderer.othersList([place("별 A"), place("별 B", { lat: 37.6 })], "목록");
		await settle();
		expect(list.querySelectorAll("ol .favorite-button")).toHaveLength(ids ? 2 : 0);
	});

	test("제목줄 경고 단추로 가게를 고르고 사유를 고르면 보내고, 알린 가게는 다음 창에서 꺼져 있다", async () => {
		const calls = useFakeSupabase({ tables: { closure_reports: { data: null, error: null } } });
		const restaurants = [place("A"), place("B", { lat: 37.6 })];
		const list = renderer.othersList(restaurants, "목록");
		const button = list.querySelector(".others-title .report-button");
		const timeout = spyOn(globalThis, "setTimeout");
		try {
			button.click();
			await settle();
			const placeDialog = [...document.querySelectorAll("dialog")].find((dialog) => dialog.open);
			expect(placeDialog.querySelector(".report-dialog-title").textContent).toBe("어느 가게예요?");
			clickDialogButton("B");
			await settle();
			clickDialogButton("문 닫았어요");
			await settle();
			expect(calls[0].ops[0][1]).toMatchObject({ name: "B", lat: 37.6, reason: "closed" });
			expect(button.textContent).toBe("알렸어요");
			timeout.mock.calls.find(([, delay]) => delay === 2000)[0]();
			expect(button.textContent).toBe("");
			expect(button.disabled).toBe(false);
		} finally {
			timeout.mockRestore();
		}
		button.click();
		await settle();
		const choices = [...document.querySelectorAll("dialog")].find((dialog) => dialog.open).querySelectorAll(".report-reasons button");
		expect([...choices].map((choice) => [choice.textContent, choice.disabled])).toEqual([["A", false], ["B · 알렸어요", true]]);
		clickDialogButton("취소");
		await settle();
		expect(calls).toHaveLength(1);
	});

	test("가게 고르는 창이나 사유 창에서 취소하면 보내지 않는다", async () => {
		const calls = useFakeSupabase({ tables: { closure_reports: { data: null, error: null } } });
		const button = renderer.othersList([place("A")], "목록").querySelector(".report-button");
		button.click();
		await settle();
		clickDialogButton("취소");
		await settle();
		button.click();
		await settle();
		clickDialogButton("A");
		await settle();
		clickDialogButton("취소");
		await settle();
		expect(calls).toEqual([]);
	});

	test("보내지 못하면 제목줄 단추에 '알리지 못했어요'를 보여 준다", async () => {
		useFakeSupabase({ tables: { closure_reports: () => {
			throw new Error("network");
		} } });
		const button = renderer.othersList([place("A")], "목록").querySelector(".report-button");
		button.click();
		await settle();
		clickDialogButton("A");
		await settle();
		clickDialogButton("정보가 없어요");
		await settle();
		expect(button.textContent).toBe("알리지 못했어요");
		expect(localStorage.getItem("omechu.reportedPlaces")).toBeNull();
	});
});

describe("즐겨찾기 별", () => {
	const star = () => renderer.restaurantCard(place("별가게"), origin).querySelector(".favorite-button");

	test("처음에는 꺼진 모양이고, 로그인하지 않았으면 누를 때 로그인 안내 창을 연다", async () => {
		const button = star();
		expect(button.getAttribute("aria-pressed")).toBe("false");
		expect(button.getAttribute("aria-label")).toBe("즐겨찾기에 넣기");
		button.click();
		await settle();
		const dialog = [...document.querySelectorAll("dialog")].find((element) => element.open);
		expect(dialog.querySelector(".report-dialog-title").textContent).toBe("즐겨찾기는 로그인하면 쓸 수 있어요");
		expect(dialog.querySelector(".login-dialog-link").getAttribute("href")).toBe("account.html");
		expect(dialog.querySelector("form > .text-button").textContent).toBe("닫기");
		expect(button.getAttribute("aria-pressed")).toBe("false");
		expect(button.disabled).toBe(false);
	});

	test("로그인 안내 창은 한 번만 만든다", async () => {
		const button = star();
		button.click();
		await settle();
		clickDialogButton("닫기");
		button.click();
		await settle();
		expect(document.querySelectorAll("dialog[aria-labelledby=loginDialogTitle]")).toHaveLength(1);
	});

	test("로그인했으면 favorite_places 에 넣고 켜진 모양으로 바꾼다", async () => {
		const calls = useFakeSupabase({
			session: { user: { id: "u1" } },
			tables: { favorite_places: (query) => (query.ops[0][0] === "select" ? { data: [], error: null } : { data: null, error: null }) },
		});
		const button = star();
		await settle();
		button.click();
		await settle();
		expect(calls.find((call) => call.ops[0][0] === "insert").ops[0][1]).toEqual({ name: "별가게", address: null, lat: 37.567, lng: 126.979 });
		expect(button.getAttribute("aria-pressed")).toBe("true");
		expect(button.getAttribute("aria-label")).toBe("즐겨찾기에서 빼기");
		const ids = await favoriteIds();
		if (ids) {
			expect(ids.has(placeId(place("별가게")))).toBe(true);
			ids.delete(placeId(place("별가게")));
		}
	});

	test("바꾸지 못하면 모양은 그대로 두고 title 로 알린다", async () => {
		useFakeSupabase({
			session: { user: { id: "u1" } },
			tables: { favorite_places: { data: null, error: { code: "42501", message: "denied" } } },
		});
		const button = star();
		await settle();
		button.click();
		await settle();
		expect(button.getAttribute("aria-pressed")).toBe("false");
		expect(button.title).toBe("즐겨찾기를 바꾸지 못했어요");
		expect(button.disabled).toBe(false);
	});
});
