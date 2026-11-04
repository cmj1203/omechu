import { beforeEach, describe, expect, test } from "bun:test";
import { failScripts, freshImport, loadPage, settle } from "./helpers/dom.js";
import { KakaoStatus, kakaoPlace, useFakeKakao } from "./helpers/fake-kakao.js";
import { initPlacePicker } from "../js/place-picker.js";

let dialog;

beforeEach(async () => {
	failScripts(false);
	await loadPage("index.html");
	dialog = document.getElementById("placePicker");
});

const message = () => dialog.querySelector(".place-picker-message");
const results = () => [...dialog.querySelectorAll(".place-picker-results li button")];

describe("loadKakao", () => {
	test("SDK 스크립트를 한 번만 붙이고 window.kakao 를 돌려준다", async () => {
		useFakeKakao();
		const fresh = await freshImport("js/place-picker.js");
		const before = document.head.querySelectorAll("script").length;
		const [first, second] = await Promise.all([fresh.loadKakao(), fresh.loadKakao()]);
		expect(first).toBe(window.kakao);
		expect(second).toBe(first);
		const added = [...document.head.querySelectorAll("script")].slice(before);
		expect(added).toHaveLength(1);
		expect(added[0].src).toStartWith("https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&libraries=services&appkey=");
	});

	test("스크립트를 못 받으면 오류를 던지고, 다음에 부르면 다시 받는다", async () => {
		useFakeKakao();
		const fresh = await freshImport("js/place-picker.js");
		failScripts(true);
		await expect(fresh.loadKakao()).rejects.toThrow("카카오 지도를 불러오지 못했어요.");
		failScripts(false);
		await expect(fresh.loadKakao()).resolves.toBe(window.kakao);
	});
});

describe("initPlacePicker", () => {
	test("검색어 없이 열면 검색 칸에 초점을 두고 아무것도 찾지 않는다", async () => {
		const log = useFakeKakao();
		const picker = initPlacePicker(dialog);
		picker.open("");
		await settle();
		expect(dialog.open).toBe(true);
		expect(document.activeElement).toBe(dialog.querySelector("input[name=q]"));
		expect(log.searches).toEqual([]);
		expect(message().hidden).toBe(true);
	});

	test("검색어로 열면 바로 찾고, 결과마다 번호·이름·도로명 주소(없으면 지번)를 보여 준다", async () => {
		const log = useFakeKakao({
			keywordSearch: () => [[
				kakaoPlace("가정역 인천2호선", { road: "인천 서구 봉오대로 지하", x: "126.67", y: "37.52" }),
				kakaoPlace("가정역 전라선", { road: "", address: "전남 곡성군 오곡면", x: "127.2", y: "35.2" }),
			], KakaoStatus.OK],
		});
		const picker = initPlacePicker(dialog);
		picker.open("가정역");
		await settle();
		expect(log.searches[0].query).toBe("가정역");
		expect(results().map((button) => button.textContent)).toEqual([
			"1가정역 인천2호선인천 서구 봉오대로 지하",
			"2가정역 전라선전남 곡성군 오곡면",
		]);
		expect(dialog.querySelector(".place-picker-map").hidden).toBe(false);
		expect(log.maps).toHaveLength(1);
		expect(log.overlays.map((overlay) => overlay.options.content.textContent)).toEqual(["1", "2"]);
		// 위에 있는 결과일수록 핀이 위로 와요.
		expect(log.overlays.map((overlay) => overlay.options.zIndex)).toEqual([2, 1]);
		expect(log.bounds[0].points).toHaveLength(2);
		expect(message().hidden).toBe(true);
	});

	test("결과를 고르면 창이 닫히고 { label, address, lat, lng } 로 답한다", async () => {
		useFakeKakao({ keywordSearch: () => [[kakaoPlace("시청역", { road: "서울 중구 세종대로 지하101", x: "126.977", y: "37.565" })], KakaoStatus.OK] });
		const picker = initPlacePicker(dialog);
		const chosen = picker.open("시청역");
		await settle();
		results()[0].click();
		expect(await chosen).toEqual({ label: "시청역", address: "서울 중구 세종대로 지하101", lat: 37.565, lng: 126.977 });
		expect(dialog.open).toBe(false);
	});

	test("지도 핀을 눌러도 고른다", async () => {
		const log = useFakeKakao({ keywordSearch: () => [[kakaoPlace("A"), kakaoPlace("B", { x: "127", y: "37" })], KakaoStatus.OK] });
		const picker = initPlacePicker(dialog);
		const chosen = picker.open("역");
		await settle();
		log.overlays[1].options.content.click();
		expect(await chosen).toMatchObject({ label: "B", lat: 37, lng: 127 });
	});

	test("닫기 단추로 닫으면 null 로 답한다", async () => {
		useFakeKakao({ keywordSearch: () => [[kakaoPlace("A")], KakaoStatus.OK] });
		const picker = initPlacePicker(dialog);
		const chosen = picker.open("A");
		await settle();
		dialog.querySelector(".place-picker-close").click();
		expect(await chosen).toBeNull();
	});

	test("두 번째 검색에서는 지도를 새로 만들지 않고 relayout 하며, 앞의 핀을 지운다", async () => {
		const log = useFakeKakao({ keywordSearch: (query) => [[kakaoPlace(query)], KakaoStatus.OK] });
		const picker = initPlacePicker(dialog);
		picker.open("A");
		await settle();
		const form = dialog.querySelector(".place-picker-form");
		form.elements.q.value = "B";
		form.requestSubmit();
		await settle();
		expect(log.maps).toHaveLength(1);
		expect(log.relayouts).toBe(1);
		expect(log.overlays[0].map).toBeNull();
		expect(log.overlays[1].map).toBe(log.maps[0]);
	});

	test("빈 칸으로 검색하면 이름을 적으라고 하고 찾지 않는다", async () => {
		const log = useFakeKakao();
		const picker = initPlacePicker(dialog);
		picker.open("");
		const form = dialog.querySelector(".place-picker-form");
		form.elements.q.value = "   ";
		form.requestSubmit();
		await settle();
		expect(message().textContent).toBe("찾을 곳의 이름을 적어 주세요.");
		expect(message().hidden).toBe(false);
		expect(log.searches).toEqual([]);
	});

	test("결과가 없으면 안내하고 지도를 숨기며 failed 는 false 다", async () => {
		useFakeKakao({ keywordSearch: () => [[], KakaoStatus.ZERO_RESULT] });
		const picker = initPlacePicker(dialog);
		picker.open("없는곳");
		await settle();
		expect(message().textContent).toBe("'없는곳' 검색 결과가 없어요. 다른 이름으로 찾아 보세요.");
		expect(dialog.querySelector(".place-picker-map").hidden).toBe(true);
		expect(picker.failed).toBe(false);
	});

	test("카카오 검색 오류면 직접 적으라고 하고 failed 가 true 가 된다", async () => {
		useFakeKakao({ keywordSearch: () => [[], KakaoStatus.ERROR] });
		const picker = initPlacePicker(dialog);
		picker.open("역");
		await settle();
		expect(message().textContent).toBe("카카오 장소 검색이 안 돼요. 창을 닫고 위치 칸에 직접 적어 주세요.");
		expect(picker.failed).toBe(true);
	});

	test("검색이 실패한 뒤 다시 찾아 성공하면 failed 를 false 로 되돌린다", async () => {
		let status = KakaoStatus.ERROR;
		useFakeKakao({ keywordSearch: () => [status === KakaoStatus.OK ? [kakaoPlace("A")] : [], status] });
		const picker = initPlacePicker(dialog);
		picker.open("A");
		await settle();
		expect(picker.failed).toBe(true);
		status = KakaoStatus.OK;
		dialog.querySelector(".place-picker-form").requestSubmit();
		await settle();
		expect(picker.failed).toBe(false);
	});

	test("창을 닫은 뒤 늦게 온 결과는 버린다", async () => {
		let reply;
		useFakeKakao({ keywordSearch: () => (callback) => {
			reply = callback;
		} });
		const picker = initPlacePicker(dialog);
		const chosen = picker.open("A");
		await settle();
		dialog.close();
		expect(await chosen).toBeNull();
		reply([], KakaoStatus.ERROR);
		expect(picker.failed).toBe(false);
		expect(message().textContent).toBe("찾는 중…");
	});

	test("앞 검색보다 늦게 온 결과는 버리고 마지막 검색 결과만 그린다", async () => {
		const replies = {};
		useFakeKakao({ keywordSearch: (query) => (callback) => {
			replies[query] = callback;
		} });
		const picker = initPlacePicker(dialog);
		picker.open("A");
		await settle();
		const form = dialog.querySelector(".place-picker-form");
		form.elements.q.value = "B";
		form.requestSubmit();
		await settle();
		replies.B([kakaoPlace("B 결과")], KakaoStatus.OK);
		replies.A([kakaoPlace("A 결과")], KakaoStatus.OK);
		expect(results().map((button) => button.querySelector("strong").textContent)).toEqual(["B 결과"]);
	});

	test("다시 열면 앞의 결과·핀·안내를 지우고 시작한다", async () => {
		const log = useFakeKakao({ keywordSearch: () => [[kakaoPlace("A")], KakaoStatus.OK] });
		const picker = initPlacePicker(dialog);
		picker.open("A");
		await settle();
		dialog.close();
		picker.open("");
		expect(results()).toEqual([]);
		expect(log.overlays[0].map).toBeNull();
		expect(dialog.querySelector(".place-picker-map").hidden).toBe(true);
		expect(message().hidden).toBe(true);
	});

	test("SDK 를 못 불러오면 안내하고 failed 가 true 가 된다", async () => {
		useFakeKakao();
		const fresh = await freshImport("js/place-picker.js");
		failScripts(true);
		const picker = fresh.initPlacePicker(dialog);
		picker.open("역");
		await settle();
		expect(message().textContent).toBe("카카오 지도를 불러오지 못했어요. 창을 닫고 위치 칸에 직접 적어 주세요.");
		expect(picker.failed).toBe(true);
	});
});

