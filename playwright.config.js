// 화면 테스트(tests/e2e). 사이트는 가짜 주소 https://app.test 로 열고, 파일은 저장소에서 바로 내보내요(tests/e2e/fixtures.js).
import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "tests/e2e",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: 0,
	reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
	use: {
		baseURL: "https://app.test",
		locale: "ko-KR",
		geolocation: { latitude: 37.5665, longitude: 126.978 },
		permissions: ["geolocation"],
		trace: "retain-on-failure",
	},
	projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
