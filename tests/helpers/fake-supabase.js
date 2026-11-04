// js/supabase.js 는 CDN 에서 라이브러리를 받아 오므로, 시험에서는 가짜 클라이언트로 바꿔 끼워요.
// 시험 파일들이 한 프로세스에서 돌아서 이 모듈 하나를 함께 써요. 각 시험에서 reset 으로 상태를 비워요.
import { mock } from "bun:test";

const state = { client: null, calls: [], failure: null, configured: true };

// bun 의 mock.module 은 getter 를 처음 값으로 굳혀서, 설정 값을 바꿀 때는 mock.module 을 다시 불러 바꿔 끼워요.
function fakeModule() {
	return {
		SUPABASE_CONFIGURED: state.configured,
		getSupabase: async () => {
			if (state.failure) {
				throw state.failure;
			}
			return state.client;
		},
	};
}

mock.module("../../js/supabase.js", fakeModule);

// respond(params, call) 가 { data, error } 를 돌려줘요. call 은 같은 반경에서 몇 번째 부름인지(0부터)예요.
export function useFakeRpc(respond) {
	reset();
	const perRadius = {};
	state.client = {
		rpc(name, params) {
			const call = perRadius[params.p_radius] ?? 0;
			perRadius[params.p_radius] = call + 1;
			state.calls.push({ name, params });
			return {
				abortSignal: async () => respond(params, call),
			};
		},
	};
	return state.calls;
}

export function useNoSupabase() {
	reset();
}

// getSupabase 가 오류를 던지게 해요(라이브러리를 못 받은 때).
export function failSupabase(error) {
	reset();
	state.failure = error;
}

// SUPABASE_CONFIGURED 값을 바꿔요. 화면 모듈은 불러올 때 이 값을 읽어서, 바꾼 뒤 모듈을 새로 불러와야 해요.
export function setConfigured(configured) {
	state.configured = configured;
	mock.module("../../js/supabase.js", fakeModule);
}

// 표·RPC·로그인을 모두 가짜로 두는 클라이언트예요.
// tables[표 이름](query) 와 rpc[함수 이름](params) 는 { data, error } 를 돌려주고, query 는 { table, ops } 예요.
// ops 는 부른 사슬 메서드를 [이름, ...인자] 로 차례대로 적은 것이에요(select, eq, order, insert …).
// auth 는 supabase.auth 자리에 그대로 들어가고, getSession 이 없으면 session 값으로 답해요.
// 돌려주는 calls 에 표·RPC 부름이 { table, ops } · { rpc, params } 로 쌓여요.
export function useFakeSupabase({ tables = {}, rpc = {}, auth = {}, session = null } = {}) {
	reset();
	const calls = state.calls;
	state.client = {
		auth: {
			getSession: async () => ({ data: { session } }),
			...auth,
		},
		from(table) {
			const query = { table, ops: [] };
			calls.push(query);
			return chain(query, () => answer(tables[table], query, "표 " + table));
		},
		rpc(name, params) {
			const query = { rpc: name, params, ops: [] };
			calls.push(query);
			return chain(query, () => answer(rpc[name], params, "RPC " + name));
		},
	};
	return calls;
}

function answer(respond, input, what) {
	if (!respond) {
		throw new Error(what + " 에 대한 가짜 답이 없어요.");
	}
	return typeof respond === "function" ? respond(input) : respond;
}

// 어떤 메서드를 불러도 자기 자신을 돌려주고, await 하면 답을 돌려줘요(supabase-js 의 PostgrestBuilder 처럼).
function chain(query, resolve) {
	const builder = new Proxy({}, {
		get(_, prop) {
			if (prop === "then") {
				return (onFulfilled, onRejected) => Promise.resolve().then(resolve).then(onFulfilled, onRejected);
			}
			if (typeof prop === "symbol") {
				return undefined;
			}
			return (...args) => {
				query.ops.push([prop, ...args]);
				return builder;
			};
		},
	});
	return builder;
}

function reset() {
	state.client = null;
	state.failure = null;
	state.calls = [];
}
