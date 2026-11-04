// js/supabase.js 는 CDN 에서 라이브러리를 받아 오므로, 시험에서는 가짜 클라이언트로 바꿔 끼워요.
// 시험 파일들이 한 프로세스에서 돌아서 이 모듈 하나를 함께 써요. 각 시험에서 reset 으로 상태를 비워요.
import { mock } from "bun:test";

const state = { client: null, calls: [] };

mock.module("../../js/supabase.js", () => ({
	SUPABASE_CONFIGURED: true,
	getSupabase: async () => state.client,
}));

// respond(params, call) 가 { data, error } 를 돌려줘요. call 은 같은 반경에서 몇 번째 부름인지(0부터)예요.
export function useFakeRpc(respond) {
	state.calls = [];
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
	state.client = null;
	state.calls = [];
}
