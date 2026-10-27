import { expect, recommend, test } from "./fixtures.js";

async function signUp(page, email = "user@example.com") {
	await page.goto("/account.html");
	await page.getByRole("tab", { name: "회원가입" }).click();
	const form = page.locator("#signupForm");
	await form.getByLabel("이메일").fill(email);
	await form.getByLabel("비밀번호 (8자 이상)").fill("password123");
	await form.getByLabel("비밀번호 확인").fill("password123");
	await form.getByRole("button", { name: "회원가입" }).click();
	await expect(page.locator("#whoami")).toHaveText(email);
}

test("로그인하지 않고 별을 누르면 로그인 안내 창이 열리고, 목록에는 별이 없다", async ({ page }) => {
	await recommend(page);
	await expect(page.locator(".others .favorite-button")).toHaveCount(0);
	await page.locator(".restaurant-name .favorite-button").click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toContainText("즐겨찾기는 로그인하면 쓸 수 있어요");
	await expect(dialog.getByRole("link", { name: "로그인·회원가입" })).toHaveAttribute("href", "account.html");
	await dialog.getByRole("button", { name: "닫기" }).click();
	await expect(dialog).toBeHidden();
});

test("회원가입 비밀번호 확인이 다르거나 짧으면 가입하지 않는다", async ({ page }) => {
	await page.goto("/account.html?tab=signup");
	const form = page.locator("#signupForm");
	await form.getByLabel("이메일").fill("a@example.com");
	await form.getByLabel("비밀번호 (8자 이상)").fill("password123");
	await form.getByLabel("비밀번호 확인").fill("password124");
	await form.getByRole("button", { name: "회원가입" }).click();
	await expect(page.locator("#signupMessage")).toHaveText("비밀번호 확인이 달라요.");
	await expect(page.locator("#memberBox")).toBeHidden();
});

test("회원은 즐겨찾기·최근 본 가게를 내 계정에서 보고, 빼고, 탈퇴할 수 있다", async ({ page, context }) => {
	await signUp(page);
	await recommend(page);

	// 추천 가게와 목록의 첫 가게를 즐겨찾기
	const cardStar = page.locator(".restaurant-name .favorite-button");
	await cardStar.click();
	await expect(cardStar).toHaveAttribute("aria-pressed", "true");
	const firstRow = page.locator(".others li").first();
	await firstRow.locator(".favorite-button").click();
	await expect(firstRow.locator(".favorite-button")).toHaveAttribute("aria-pressed", "true");
	const picked = await page.locator(".restaurant-name .place-name-link").textContent();

	// 지도에서 보기를 열면 최근 본 가게에 남아요(새 창은 바로 닫아요)
	context.on("page", (popup) => popup.close());
	await page.getByRole("link", { name: "지도에서 보기 ↗" }).click();

	await page.goto("/account.html");
	await expect(page.locator("#favoriteList li")).toHaveCount(2);
	await expect(page.locator("#favoriteCount")).toHaveText("(2곳)");
	await expect(page.locator("#recentList li")).toHaveCount(1);
	await expect(page.locator("#recentList li")).toContainText(picked);

	await page.locator("#favoriteList li").filter({ hasText: picked }).getByRole("button", { name: "빼기" }).click();
	await expect(page.locator("#favoriteList li")).toHaveCount(1);

	// 다시 추천 화면에 가면 뺀 가게의 별은 비어 있어요
	await recommend(page);
	await expect(page.locator(".restaurant-name .favorite-button")).toHaveAttribute("aria-pressed", "false");

	await page.goto("/account.html");
	page.once("dialog", (dialog) => dialog.accept());
	await page.getByRole("button", { name: "회원 탈퇴" }).click();
	await expect(page.locator("#loginMessage")).toHaveText("탈퇴했어요. 그동안 고마웠어요.");
	await expect(page.locator("#loginForm")).toBeVisible();
});

test("일반 회원으로 관리자 화면에 가면 로그아웃시키지 않고 내 계정으로 안내한다", async ({ page }) => {
	await signUp(page);
	await expect(page.locator("#adminLink")).toBeHidden();
	await page.goto("/admin.html");
	await expect(page.locator("#adminNotice")).toContainText("관리자 권한이 없는 계정이에요");
	await page.goto("/account.html");
	await expect(page.locator("#whoami")).toHaveText("user@example.com");
});
