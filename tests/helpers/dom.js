// 화면 모듈(js/*.js 중 document 를 쓰는 것)을 bun 에서 시험하려고 happy-dom 으로 브라우저 전역(document, window, localStorage …)을 만들어요.
// 시험 파일들이 한 프로세스에서 돌아서 한 번만 등록하고, 각 시험은 loadPage 로 화면 내용만 바꿔 끼워요.
// 바깥 스크립트(카카오·구글 SDK)는 받지 않고, 받은 것으로 쳐서 load 이벤트만 보내요. 실패를 시험하려면 failScripts(true) 를 불러요.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!globalThis.happyDOM) {
	GlobalRegistrator.register({
		url: "https://app.test/",
		settings: {
			disableJavaScriptFileLoading: true,
			handleDisabledFileLoadingAsSuccess: true,
			disableCSSFileLoading: true,
			disableIframePageLoading: true,
		},
	});
}

// happy-dom 전역에는 new Option(글자) 생성자가 없어서, 브라우저와 같은 일(글자·값이 같은 option)을 하는 것을 둬요.
if (typeof globalThis.Option !== "function") {
	globalThis.Option = function Option(text = "") {
		const option = document.createElement("option");
		option.textContent = text;
		return option;
	};
}

const pageCache = new Map();

// 저장소의 HTML 파일(index.html 등)의 body 를 지금 문서에 넣고 주소를 바꿔요. 스크립트 태그는 빼요.
export async function loadPage(file, search = "") {
	if (!pageCache.has(file)) {
		const html = await Bun.file(new URL("../../" + file, import.meta.url)).text();
		const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? "";
		pageCache.set(file, body.replace(/<script[\s\S]*?<\/script>/gi, ""));
	}
	window.happyDOM.setURL("https://app.test/" + file + search);
	document.body.innerHTML = pageCache.get(file);
	return document;
}

// 주어진 HTML 조각만 body 에 넣어요(HTML 파일이 없는 작은 시험용).
export function setBody(html, url = "https://app.test/") {
	window.happyDOM.setURL(url);
	document.body.innerHTML = html;
	return document;
}

// fail 이면 바깥 스크립트가 error 이벤트를 보내요. 그때 happy-dom 이 console.error 로 찍는 'JavaScript file loading is disabled' 는 감춰요.
const consoleError = console.error;
export function failScripts(fail) {
	window.happyDOM.settings.handleDisabledFileLoadingAsSuccess = !fail;
	console.error = fail
		? (...args) => {
			if (!String(args[0]?.message ?? args[0]).includes("JavaScript file loading is disabled")) {
				consoleError(...args);
			}
		}
		: consoleError;
}

// 기다리던 약속(promise)과 setTimeout(0) 이 모두 돌게 몇 번 양보해요.
export async function settle(rounds = 5) {
	for (let i = 0; i < rounds; i += 1) {
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
}

// 모듈을 새로 불러와요(path 는 저장소 기준, 예: "js/app.js"). 같은 주소는 한 번만 실행되므로 물음표 뒤 글자를 바꿔 매번 새로 실행해요.
// 그 모듈이 부르는 다른 모듈(./member.js 등)은 새로 불러오지 않고 함께 써요.
let importCount = 0;
export function freshImport(path) {
	importCount += 1;
	return import("../../" + path + "?fresh=" + importCount);
}
