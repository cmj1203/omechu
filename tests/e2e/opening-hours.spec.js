import { expect, recommend, test } from "./fixtures.js";

const cases = [
	{
		name: "특별 영업시간이 정기 시간표보다 우선한다",
		now: "2026-10-29T03:00:00Z",
		periods: [{ open: { day: 4, hour: 12, minute: 0 }, close: { day: 4, hour: 18, minute: 30 } }],
		expected: "12:00~18:30",
		open: true,
	},
	{
		name: "임시 휴일에는 정기 시간표를 오늘 시간으로 표시하지 않는다",
		now: "2026-10-29T03:00:00Z",
		periods: [],
		expected: "--:--",
		open: false,
	},
	{
		name: "전날 밤에 열어 오늘 새벽에 닫는 시간을 포함한다",
		now: "2026-10-28T16:00:00Z",
		periods: [{ open: { day: 3, hour: 20, minute: 0 }, close: { day: 4, hour: 2, minute: 0 } }],
		expected: "00:00~02:00",
		open: true,
	},
	{
		name: "토요일 밤에서 일요일 새벽으로 넘어가는 시간도 포함한다",
		now: "2026-10-24T16:00:00Z",
		periods: [{ open: { day: 6, hour: 20, minute: 0 }, close: { day: 0, hour: 2, minute: 0 } }],
		expected: "00:00~02:00",
		open: true,
	},
	{
		name: "새벽 영업과 오늘 다시 여는 시간을 시각 순으로 표시한다",
		now: "2026-10-28T16:00:00Z",
		periods: [
			{ open: { day: 4, hour: 18, minute: 0 }, close: { day: 5, hour: 2, minute: 0 } },
			{ open: { day: 3, hour: 20, minute: 0 }, close: { day: 4, hour: 2, minute: 0 } },
		],
		expected: "00:00~02:00, 18:00~02:00",
		open: true,
	},
	{
		name: "오늘 자정에 끝난 전날 영업은 빼고 쉬는 시간을 유지한다",
		now: "2026-10-29T03:00:00Z",
		periods: [
			{ open: { day: 3, hour: 18, minute: 0 }, close: { day: 4, hour: 0, minute: 0 } },
			{ open: { day: 4, hour: 11, minute: 0 }, close: { day: 4, hour: 15, minute: 0 } },
			{ open: { day: 4, hour: 17, minute: 0 }, close: { day: 4, hour: 21, minute: 0 } },
		],
		expected: "11:00~15:00, 17:00~21:00",
		open: true,
	},
	{
		name: "상시 영업은 요일과 관계없이 표시한다",
		now: "2026-10-29T03:00:00Z",
		periods: [{ open: { day: 0, hour: 0, minute: 0 } }],
		expected: "24시간",
		open: true,
	},
	{
		name: "현재 영업시간을 모르면 정기 시간표로 대신하지 않는다",
		now: "2026-10-29T03:00:00Z",
		periods: null,
		expected: "--:--",
		open: undefined,
	},
];

for (const scenario of cases) {
	test.describe(scenario.name, () => {
		test.use({
			timezoneId: "America/Los_Angeles",
			places: [["테스트", 100, {
				rating: 4.5, reviews: 100, hours: [[11, 0], [21, 30]],
				currentPeriods: scenario.periods, open: scenario.open,
			}]],
		});

		test("가게 현지 날짜로 영업시간과 상태를 표시한다", async ({ page }) => {
			await page.clock.setFixedTime(new Date(scenario.now));
			await recommend(page);
			const hours = page.locator(".restaurant-hours");
			await expect(hours).toContainText(scenario.expected);
			const status = hours.locator(".open-status");
			if (scenario.open === undefined) {
				await expect(status).toHaveCount(0);
			} else {
				await expect(status).toHaveCount(1);
				await expect(status).toHaveClass(scenario.open ? "open-status" : "open-status closed");
			}
		});
	});
}
