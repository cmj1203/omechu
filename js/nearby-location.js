const GEO_ERRORS = {
	1: "위치 권한이 꺼져 있어요. 주소창 왼쪽 아이콘에서 위치를 '허용'으로 바꾸거나, 위치 칸에 동네 이름을 적어 주세요.",
	2: "현재 위치를 알 수 없어요. 기기의 위치 서비스를 켜거나, 위치 칸에 동네 이름을 적어 주세요.",
	3: "위치를 확인하는 데 너무 오래 걸려요. 다시 누르거나, 위치 칸에 동네 이름을 적어 주세요.",
};

export async function locationAlreadyAllowed() {
	if (!navigator.permissions) {
		return false;
	}
	const status = await navigator.permissions.query({ name: "geolocation" });
	return status.state === "granted";
}

export function currentPosition() {
	return new Promise((resolve, reject) => {
		if (!window.isSecureContext || !navigator.geolocation) {
			reject(new Error("현재 위치는 https 주소나 localhost 에서만 쓸 수 있어요. 위치 칸에 동네 이름을 적어 주세요."));
			return;
		}
		navigator.geolocation.getCurrentPosition(
			(position) => resolve({ label: "현재 위치", lat: position.coords.latitude, lng: position.coords.longitude }),
			(error) => reject(new Error(GEO_ERRORS[error.code] || "현재 위치를 가져오지 못했어요. 위치 칸에 동네 이름을 적어 주세요.")),
			{ timeout: 10000, maximumAge: 60000 },
		);
	});
}

export async function geocode(place) {
	const url = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({
		q: place,
		format: "json",
		limit: "1",
		countrycodes: "kr",
		"accept-language": "ko",
	});
	const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
	if (!response.ok) {
		throw new Error("동네 위치를 찾지 못했어요. 잠시 후 다시 눌러 주세요.");
	}
	const [first] = await response.json();
	if (!first) {
		throw new Error("'" + place + "' 위치를 찾지 못했어요. 역 이름이나 동 이름으로 적어 주세요.");
	}
	return { label: place, lat: Number(first.lat), lng: Number(first.lon) };
}
