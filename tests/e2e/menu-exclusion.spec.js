import { expect, recommend, test } from "./fixtures.js";

test("뺀 메뉴를 모두 펼쳐 선택한 메뉴만 복원하고 마지막 항목까지 지울 수 있다", async ({ page }) => {
	await recommend(page);
	const names = [];
	for (let index = 0; index < 5; index += 1) {
		const name = await page.locator(".menu-name").textContent();
		names.push(name);
		await page.getByRole("button", { name: "메뉴 빼기", exact: true }).click();
		await expect(page.locator(".menu-name")).not.toHaveText(name);
	}
	const current = await page.locator(".menu-name").textContent();
	const details = page.locator("#skippedMenus");
	const items = page.locator(".skipped-list li > span");
	await expect(details).toHaveJSProperty("open", false);
	await details.locator("summary").press("Enter");
	await expect(details).toHaveJSProperty("open", true);
	await expect(items).toHaveText(names);

	await page.getByRole("button", { name: names[1] + " 다시 넣기", exact: true }).click();
	const remaining = names.filter((name) => name !== names[1]);
	await expect(items).toHaveText(remaining);
	await expect(details).toHaveJSProperty("open", true);
	await expect(page.locator(".menu-name")).toHaveText(current);
	await expect(page.getByRole("button", { name: names[2] + " 다시 넣기", exact: true })).toBeFocused();

	for (const name of remaining) {
		await page.getByRole("button", { name: name + " 다시 넣기", exact: true }).click();
	}
	await expect(details).toBeHidden();
	await expect(items).toHaveCount(0);
	await expect(page.getByRole("button", { name: "메뉴 빼기", exact: true })).toBeFocused();
});

test("모든 메뉴를 뺐어도 하나만 복원하면 그 메뉴로 추천을 다시 시작한다", async ({ page }) => {
	const menus = ["김치찌개", "비빔밥"].map((name) => ({
		name, kinds: ["식사"], cuisine: "한식", search_terms: [name],
	}));
	await page.route("**/data/menus.json", (route) => route.fulfill({ json: menus }));
	await recommend(page);
	for (const menu of menus) {
		await expect(page.locator(".menu-name")).toHaveText(menu.name);
		await page.getByRole("button", { name: "메뉴 빼기", exact: true }).click();
	}
	await expect(page.locator(".menu-name")).toHaveCount(0);
	await page.locator("#skippedMenus summary").click();
	await page.getByRole("button", { name: "김치찌개 다시 넣기", exact: true }).click();
	await expect(page.locator(".menu-name")).toHaveText("김치찌개");
	await expect(page.locator(".skipped-list li > span")).toHaveText(["비빔밥"]);
	await expect(page.locator("#skippedMenus")).toHaveJSProperty("open", true);

	await page.getByRole("button", { name: "메뉴 빼기", exact: true }).click();
	await expect(page.locator(".menu-name")).toHaveCount(0);
	await page.getByRole("button", { name: "비빔밥 다시 넣기", exact: true }).click();
	await expect(page.locator(".menu-name")).toHaveText("비빔밥");
	await expect(page.locator(".skipped-list li > span")).toHaveText(["김치찌개"]);
});
